import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, writeSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { LogEntryMeta, ProxyLogEvent } from '../shared/types'

// сколько последних записей отдаём в renderer при первичной загрузке — это лимит ОТОБРАЖЕНИЯ,
// не хранения: на диске лежит весь лог сессии
const RECENT_LIMIT = 2000

// потолок размера файла сессии — лог содержит тела и (частично) заголовки всего трафика и растёт
// без предела на активной сессии; после потолка новые записи в файл не пишутся (в renderer идут
// по-прежнему), пользователь видит предупреждение один раз
const MAX_SESSION_FILE_BYTES = 100 * 1024 * 1024 // 100 МБ

// сколько файлов прошлых сессий держим на диске — файл лога содержит секреты (см. addon.py:
// заголовки редактируются, но URL и тела остаются), незачем копить их бесконечно
const KEEP_SESSION_FILES = 20

// потолок индекса в памяти (~200 байт на запись): на очень длинной сессии за чатливым приложением
// счёт идёт на сотни тысяч запросов. После потолка самые старые записи выпадают из индекса —
// список/поиск их больше не видят, но файл сессии всё равно ограничен MAX_SESSION_FILE_BYTES
const MAX_INDEX_ENTRIES = 200_000

const SESSION_FILE_RE = /^traffic-\d+\.jsonl$/

/** Запись индекса в памяти: лёгкие поля для списка/поиска + положение полной строки в файле,
 * чтобы getEvent читал одну строку, а не парсил весь файл */
interface IndexEntry extends LogEntryMeta {
  byteOffset: number
  byteLength: number
}

/** Копирует только лёгкие поля записи (для списка) — и из полного события, и из записи индекса
 * (обе структурно содержат поля LogEntryMeta), отбрасывая тела/заголовки и служебные смещения */
function toMeta(entry: LogEntryMeta): LogEntryMeta {
  return {
    event: entry.event,
    url: entry.url,
    file: entry.file,
    method: entry.method,
    statusCode: entry.statusCode,
    responseSize: entry.responseSize,
    ts: entry.ts,
    requestBodyIsBinary: entry.requestBodyIsBinary,
    requestBodySize: entry.requestBodySize,
    responseBodyIsBinary: entry.responseBodyIsBinary
  }
}

/**
 * Хранилище лога трафика: полные события пишутся построчным JSON (JSONL) в файл сессии, в памяти
 * держится лёгкий индекс (метаданные + положение строки в файле). Тело события читается из файла
 * по смещению — одна строка, без парсинга всего файла. Каждый запуск приложения — новый файл
 * traffic-<timestamp>.jsonl; при старте удаляются все, кроме KEEP_SESSION_FILES последних. Файл
 * сессии перестаёт расти после MAX_SESSION_FILE_BYTES. Кнопка «очистить» в UI чистит только
 * отображение в renderer — файл на диске остаётся.
 */
class LogStore {
  private readonly dir = join(app.getPath('userData'), 'traffic-logs')
  private readonly filePath = join(this.dir, `traffic-${Date.now()}.jsonl`)
  // дескриптор файла на запись держим открытым: writeSync пишет синхронно и сразу на диск,
  // поэтому byteOffset из индекса всегда валиден для чтения в getEvent (в отличие от буферизованного
  // WriteStream, где только что записанная строка могла ещё не долететь до файла)
  private writeFd: number | null = null
  private bytesWritten = 0
  // true после первого превышения потолка размера — чтобы предупредить renderer один раз
  private sizeLimitHit = false
  // индекс записей (последние MAX_INDEX_ENTRIES): метаданные + смещение/длина строки в файле
  private index: IndexEntry[] = []
  // всего записей за сессию — монотонный счётчик для инвалидации bodyCache (index.length
  // перестаёт расти после потолка, а событий в файле по-прежнему прибавляется)
  private totalAppended = 0
  // кэш полного разбора файла для поиска по телу: валиден, пока не добавились новые записи
  private bodyCache: { count: number; events: ProxyLogEvent[] } | null = null

  constructor() {
    this.pruneOldSessionFiles()
  }

  /** Удаляет файлы прошлых сессий, кроме KEEP_SESSION_FILES самых свежих (по имени = по времени старта) */
  private pruneOldSessionFiles(): void {
    let names: string[]
    try {
      names = readdirSync(this.dir).filter((name) => SESSION_FILE_RE.test(name))
    } catch {
      // папки ещё нет — чистить нечего
      return
    }
    const stale = names.sort().slice(0, Math.max(0, names.length - KEEP_SESSION_FILES))
    for (const name of stale) {
      try {
        rmSync(join(this.dir, name), { force: true })
      } catch {
        // не удалось удалить один файл — не критично, продолжаем
      }
    }
  }

  private ensureWriteFd(): number {
    if (this.writeFd === null) {
      mkdirSync(this.dir, { recursive: true })
      this.writeFd = openSync(this.filePath, 'a')
    }
    return this.writeFd
  }

  /** Пишет строку целиком (writeSync может записать не всё за раз) — иначе byteOffset в индексе
   * разъедется с реальным содержимым файла */
  private writeLine(line: string): void {
    const buf = Buffer.from(line, 'utf-8')
    let written = 0
    while (written < buf.length) {
      written += writeSync(this.ensureWriteFd(), buf, written)
    }
  }

  /** true, если файл сессии перестал расти из-за потолка размера — renderer показывает это один раз */
  consumeSizeLimitWarning(): boolean {
    if (!this.sizeLimitHit) return false
    this.sizeLimitHit = false
    return true
  }

  /** Дописывает пачку событий в файл, возвращает их лёгкие версии для отправки в renderer.
   * Индекс/renderer получают все записи; в файл запись прекращается после MAX_SESSION_FILE_BYTES
   * (тогда byteLength = 0 — событие есть в списке, но тела на диске нет). */
  appendBatch(events: ProxyLogEvent[]): LogEntryMeta[] {
    if (events.length === 0) return []
    const metas: LogEntryMeta[] = []
    for (const event of events) {
      const line = `${JSON.stringify(event)}\n`
      const lineBytes = Buffer.byteLength(line, 'utf-8')
      // byteLength 0 = строка в файл не попала (превышен потолок размера); getEvent вернёт null
      let byteOffset = 0
      let byteLength = 0

      if (this.bytesWritten + lineBytes <= MAX_SESSION_FILE_BYTES) {
        this.writeLine(line)
        byteOffset = this.bytesWritten
        byteLength = lineBytes
        this.bytesWritten += lineBytes
      } else if (!this.sizeLimitHit) {
        this.sizeLimitHit = true
      }

      const entry: IndexEntry = { ...toMeta(event), byteOffset, byteLength }
      this.index.push(entry)
      this.totalAppended++
      metas.push(toMeta(entry))
    }
    if (this.index.length > MAX_INDEX_ENTRIES) {
      this.index.splice(0, this.index.length - MAX_INDEX_ENTRIES)
    }
    return metas
  }

  /** Полное событие с этим ts — читает одну строку из файла по смещению из индекса */
  getEvent(ts: number): ProxyLogEvent | null {
    const entry = this.index.find((e) => e.ts === ts)
    if (!entry || entry.byteLength === 0) return null
    try {
      const fd = openSync(this.filePath, 'r')
      try {
        const buf = Buffer.allocUnsafe(entry.byteLength)
        readSync(fd, buf, 0, entry.byteLength, entry.byteOffset)
        return JSON.parse(buf.toString('utf-8')) as ProxyLogEvent
      } finally {
        closeSync(fd)
      }
    } catch {
      return null
    }
  }

  /** Все полные события файла лога — для экспорта (редкое действие, разбор всего файла) */
  readAll(): ProxyLogEvent[] {
    const events: ProxyLogEvent[] = []
    for (const line of this.readLines()) {
      try {
        events.push(JSON.parse(line) as ProxyLogEvent)
      } catch {
        // битая строка (обрыв записи) — пропускаем
      }
    }
    return events
  }

  /** Последние записи для первичной отрисовки списка */
  getRecent(): LogEntryMeta[] {
    return this.index.slice(-RECENT_LIMIT).map(toMeta)
  }

  /** Метаданные записей, чьи url/method/тело содержат query (по телу — только с searchInBody) */
  search(query: string, searchInBody: boolean): LogEntryMeta[] {
    const q = query.trim().toLowerCase()
    if (!q) return this.getRecent()

    const matchedTs = new Set(
      this.index
        .filter((m) => m.url.toLowerCase().includes(q) || (m.event === 'matched' && m.file.toLowerCase().includes(q)))
        .map((m) => m.ts)
    )

    if (searchInBody) {
      for (const event of this.eventsForBodySearch()) {
        if (matchedTs.has(event.ts)) continue
        if (event.requestBody.toLowerCase().includes(q) || event.responseBody.toLowerCase().includes(q)) {
          matchedTs.add(event.ts)
        }
      }
    }

    return this.index.filter((m) => matchedTs.has(m.ts)).map(toMeta)
  }

  /** Разбор всех событий для поиска по телу с кэшем: файл append-only, число записей растёт —
   * пока index.length не изменился с прошлого поиска, переиспользуем разобранный массив, а не
   * читаем и парсим файл заново на каждое нажатие клавиши */
  private eventsForBodySearch(): ProxyLogEvent[] {
    if (this.bodyCache && this.bodyCache.count === this.totalAppended) {
      return this.bodyCache.events
    }
    const events = this.readAll()
    this.bodyCache = { count: this.totalAppended, events }
    return events
  }

  private readLines(): string[] {
    try {
      return readFileSync(this.filePath, 'utf-8').split('\n').filter(Boolean)
    } catch {
      return []
    }
  }
}

export const logStore = new LogStore()
