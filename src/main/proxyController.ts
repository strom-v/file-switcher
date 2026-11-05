import { EventEmitter } from 'events'
import { platform } from './platform'
import { logStore } from './logStore'
import { ProxyServer } from './proxy/proxyServer'
import { DEFAULT_PROXY_PORT } from '../shared/constants'
import type { ProxyState, ProxyLogEvent } from '../shared/types'

export type { ProxyStatus, ProxyState, ProxyLogEvent } from '../shared/types'

// события лога копятся и эмиттятся пачкой раз в этот интервал, а не по одному на каждый запрос —
// при активном трафике (десятки запросов в секунду, например при загрузке тяжёлой страницы) это
// заметно снижает частоту IPC-сообщений и React-рендеров в renderer
const LOG_BATCH_INTERVAL_MS = 50

// показывается один раз, когда файл лога сессии достиг потолка размера и запись в него прекратилась
const LOG_SIZE_LIMIT_MESSAGE =
  'Файл лога сессии достиг 100 МБ — новые запросы больше не сохраняются на диск (в списке отображаются). Экспортируйте лог и перезапустите приложение, чтобы начать новый файл.'

const PROXY_HOST = '127.0.0.1'

/** Управляет встроенным прокси-сервером: запуск, остановка, системный прокси, лог */
export class ProxyController extends EventEmitter {
  private server: ProxyServer | null = null
  private state: ProxyState = { status: 'stopped', port: DEFAULT_PROXY_PORT }
  private pendingLogs: ProxyLogEvent[] = []
  private logBatchTimer: NodeJS.Timeout | null = null
  private systemProxyQueue: Promise<void> = Promise.resolve()
  // предупреждения движка (битый regex, недоступный файл) показываем по разу за запуск, а не на каждый запрос
  private shownWarnings = new Set<string>()

  getState(): ProxyState {
    return this.state
  }

  private setState(next: ProxyState): void {
    this.state = next
    this.emit('status', this.state)
  }

  start(rulesFilePath: string, port: number = DEFAULT_PROXY_PORT): void {
    if (this.server) {
      return
    }

    this.setState({ status: 'starting', port })
    this.shownWarnings.clear()

    let server: ProxyServer
    try {
      server = new ProxyServer(
        rulesFilePath,
        (event) => this.queueLogEvent(event),
        (message) => this.showWarning(message)
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.setState({ status: 'crashed', port, error: `Не удалось запустить прокси: ${message}` })
      return
    }
    this.server = server

    // обработчики ниже проверяют this.server === server: Stop сразу после Start (или Stop → Start
    // до завершения listen) не должен дать устаревшему серверу перезаписать состояние актуального
    server
      .listen(PROXY_HOST, port)
      .then(() => {
        if (this.server !== server) return
        this.setState({ status: 'running', port })
        this.applySystemProxy(server, port)
      })
      .catch((err: unknown) => {
        if (this.server !== server) return
        this.server = null
        const isPortBusy = err instanceof Error && 'code' in err && err.code === 'EADDRINUSE'
        const message = err instanceof Error ? err.message : String(err)
        const error = isPortBusy ? `Порт ${port} уже занят другим процессом` : `Прокси не запустился: ${message}`
        this.setState({ status: 'crashed', port, error })
      })
  }

  private showWarning(message: string): void {
    if (this.shownWarnings.has(message)) return
    this.shownWarnings.add(message)
    this.emit('stderr', message)
  }

  async stop(): Promise<void> {
    // события за последние LOG_BATCH_INTERVAL_MS до Stop уже приняты — дописываем их
    // в файл и отдаём в renderer, иначе быстрый запрос перед остановкой пропал бы бесследно
    this.flushPendingLogs()

    this.server?.close()
    this.server = null
    this.setState({ status: 'stopped', port: this.state.port })
    await this.revertSystemProxy()
  }

  /** Последовательно выполняет изменения системного прокси */
  private enqueueSystemProxyOperation(operation: () => Promise<void>): Promise<void> {
    const result = this.systemProxyQueue.then(operation)
    this.systemProxyQueue = result.catch(() => {})
    return result
  }

  /** Восстанавливает системный прокси после аварийного завершения прошлого запуска */
  recoverStaleSystemProxy(host: string): Promise<void> {
    return this.enqueueSystemProxyOperation(() => platform.systemProxy.recoverStale(host))
  }

  /** Включает системный HTTP/HTTPS-прокси ОС на активных интерфейсах (реализация зависит от платформы) */
  private applySystemProxy(server: ProxyServer, port: number): void {
    void this.enqueueSystemProxyOperation(async () => {
      // Stop мог отменить запуск, пока в очереди завершалось восстановление прошлого состояния.
      if (this.server !== server) return
      try {
        await platform.systemProxy.enable(PROXY_HOST, port)
      } catch (err) {
        // пользователь мог отменить системный диалог авторизации, либо платформа не поддерживает
        // авто-настройку — прокси-сервер всё равно работает, трафик нужно направить вручную
        const message = err instanceof Error ? err.message : String(err)
        this.emit('stderr', `Не удалось включить системный прокси автоматически: ${message}`)
      }
    })
  }

  /** Возвращает системный прокси ОС в состояние до запуска */
  private revertSystemProxy(): Promise<void> {
    return this.enqueueSystemProxyOperation(async () => {
      try {
        await platform.systemProxy.disable()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.emit('stderr', `Не удалось восстановить системный прокси: ${message}`)
      }
    })
  }

  // копит события в pendingLogs и один раз на интервал пишет пачку в файл лога, а в renderer
  // эмиттит только лёгкие метаданные (тела/заголовки остаются на диске) — это и снижает частоту
  // IPC-сообщений, и держит память renderer маленькой
  private queueLogEvent(event: ProxyLogEvent): void {
    this.pendingLogs.push(event)
    if (this.logBatchTimer) return
    this.logBatchTimer = setTimeout(() => this.flushPendingLogs(), LOG_BATCH_INTERVAL_MS)
  }

  /** Атомарно забирает накопленные события, пишет пачку в файл и эмиттит метаданные в renderer */
  private flushPendingLogs(): void {
    if (this.logBatchTimer) {
      clearTimeout(this.logBatchTimer)
      this.logBatchTimer = null
    }
    if (this.pendingLogs.length === 0) return

    const batch = this.pendingLogs
    this.pendingLogs = []
    try {
      // appendBatch сам глушит ошибки записи на диск (переводит логирование в disabled),
      // поэтому здесь ловим только неожиданные сбои, чтобы они не стали uncaught в main
      this.emit('logBatch', logStore.appendBatch(batch))
      if (logStore.consumeSizeLimitWarning()) {
        this.emit('stderr', LOG_SIZE_LIMIT_MESSAGE)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emit('stderr', `Ошибка записи traffic-log: ${message}`)
    }
  }
}

export const proxyController = new ProxyController()
