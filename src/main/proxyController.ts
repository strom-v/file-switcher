import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { EventEmitter } from 'events'
import { existsSync } from 'fs'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { platform } from './platform'
import { logStore } from './logStore'
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

/** Управляет дочерним процессом mitmdump: запуск, остановка, разбор stdout */
export class ProxyController extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private state: ProxyState = { status: 'stopped', port: DEFAULT_PROXY_PORT }
  private stdoutBuffer = ''
  private lastStderr = ''
  private pendingLogs: ProxyLogEvent[] = []
  private logBatchTimer: NodeJS.Timeout | null = null
  private systemProxyQueue: Promise<void> = Promise.resolve()

  getState(): ProxyState {
    return this.state
  }

  private setState(next: ProxyState): void {
    this.state = next
    this.emit('status', this.state)
  }

  // electron-vite кладёт скомпилированный main в out/main/proxyController.js — оба уровня '..'
  // поднимаются к корню проекта именно оттуда; если output-структура electron-vite изменится,
  // менять нужно только эту константу, а не искать все места с магическим числом '..'
  private readonly devProjectRoot = join(__dirname, '..', '..')

  /** Путь к standalone-бинарнику mitmdump (PyInstaller) либо к venv-бинарнику в dev-режиме */
  private resolveMitmdumpPath(): string {
    if (is.dev) {
      // venv кладёт исполняемые в bin/ (POSIX) либо Scripts/ (Windows)
      const venvBinDir = process.platform === 'win32' ? 'Scripts' : 'bin'
      return join(this.devProjectRoot, '.venv', venvBinDir, platform.paths.mitmdumpBinName)
    }
    return join(process.resourcesPath, 'bin', platform.paths.mitmdumpBinDir, platform.paths.mitmdumpBinName)
  }

  private resolveAddonPath(): string {
    if (is.dev) {
      return join(this.devProjectRoot, 'resources', 'addon.py')
    }
    return join(process.resourcesPath, 'addon.py')
  }

  start(rulesFilePath: string, port: number = DEFAULT_PROXY_PORT): void {
    if (this.child) {
      return
    }

    const mitmdumpPath = this.resolveMitmdumpPath()
    if (!existsSync(mitmdumpPath)) {
      this.setState({ status: 'crashed', port, error: `mitmdump не найден: ${mitmdumpPath}` })
      return
    }

    const addonPath = this.resolveAddonPath()
    if (!existsSync(addonPath)) {
      this.setState({ status: 'crashed', port, error: `addon.py не найден: ${addonPath}` })
      return
    }

    this.setState({ status: 'starting', port })
    this.lastStderr = ''

    const args = [
      '-s',
      addonPath,
      '--set',
      `rules_file=${rulesFilePath}`,
      '--listen-host',
      '127.0.0.1',
      '--listen-port',
      String(port)
    ]

    const child = spawn(mitmdumpPath, args)
    this.child = child

    // все обработчики ниже проверяют this.child === child перед тем, как трогать состояние
    // контроллера — иначе события от уже убитого (Stop сразу после Start) или устаревшего
    // (Stop → Start до того, как старый процесс успел завершиться) child могут перезаписать
    // состояние актуального процесса или откатить системный прокси, который включил кто-то другой
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.child !== child) return
      this.handleStdout(chunk.toString())
    })

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      this.lastStderr = text
      if (this.child !== child) return
      this.emit('stderr', text)
    })

    child.on('spawn', () => {
      if (this.child !== child) return
      this.setState({ status: 'running', port })
      this.applySystemProxy(child, port)
    })

    child.on('error', (err) => {
      if (this.child !== child) return
      this.setState({ status: 'crashed', port, error: err.message })
      this.child = null
      void this.revertSystemProxy()
    })

    child.on('exit', (code) => {
      if (this.child !== child) return
      const wasRunning = this.state.status === 'running' || this.state.status === 'starting'
      this.child = null
      if (wasRunning && code !== 0) {
        const isPortBusy = /address already in use|errno 48|errno 98/i.test(this.lastStderr)
        const error = isPortBusy ? `Порт ${port} уже занят другим процессом` : `mitmdump завершился с кодом ${code}`
        this.setState({ status: 'crashed', port, error })
      } else if (this.state.status !== 'stopped') {
        this.setState({ status: 'stopped', port })
      }
      void this.revertSystemProxy()
    })
  }

  async stop(): Promise<void> {
    if (this.logBatchTimer) {
      clearTimeout(this.logBatchTimer)
      this.logBatchTimer = null
    }
    this.pendingLogs = []

    if (!this.child) {
      this.setState({ status: 'stopped', port: this.state.port })
      await this.revertSystemProxy()
      return
    }
    // обнуляем сразу, а не в обработчике 'exit' — иначе start(), вызванный сразу после stop()
    // до того как старый процесс реально завершился, увидит this.child ещё не null и молча
    // откажется запускать новый (early return в начале start())
    this.child.kill()
    this.child = null
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
  private applySystemProxy(child: ChildProcessWithoutNullStreams, port: number): void {
    void this.enqueueSystemProxyOperation(async () => {
      // Stop мог отменить запуск, пока в очереди завершалось восстановление прошлого состояния.
      if (this.child !== child) return
      try {
        await platform.systemProxy.enable('127.0.0.1', port)
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

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    const lines = this.stdoutBuffer.split('\n')
    this.stdoutBuffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as ProxyLogEvent
        this.queueLogEvent(parsed)
      } catch {
        // строки без JSON (баннер mitmdump и т.п.) молча пропускаем
      }
    }
  }

  // копит события в pendingLogs и один раз на интервал пишет пачку в файл лога, а в renderer
  // эмиттит только лёгкие метаданные (тела/заголовки остаются на диске) — это и снижает частоту
  // IPC-сообщений, и держит память renderer маленькой
  private queueLogEvent(event: ProxyLogEvent): void {
    this.pendingLogs.push(event)
    if (this.logBatchTimer) return

    this.logBatchTimer = setTimeout(() => {
      const batch = this.pendingLogs
      this.pendingLogs = []
      this.logBatchTimer = null
      this.emit('logBatch', logStore.appendBatch(batch))
      if (logStore.consumeSizeLimitWarning()) {
        this.emit('stderr', LOG_SIZE_LIMIT_MESSAGE)
      }
    }, LOG_BATCH_INTERVAL_MS)
  }
}

export const proxyController = new ProxyController()
