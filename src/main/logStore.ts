import { createWriteStream, mkdirSync, readFileSync, type WriteStream } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { LogEntryMeta, ProxyLogEvent } from '../shared/types'

// сколько последних записей отдаём в renderer при первичной загрузке — это лимит ОТОБРАЖЕНИЯ,
// не хранения: на диске лежит весь лог сессии
const RECENT_LIMIT = 2000

/** Отделяет лёгкие поля записи (для списка) от полного события (тела/заголовки — только на диске) */
function toMeta(event: ProxyLogEvent): LogEntryMeta {
  return {
    event: event.event,
    url: event.url,
    file: event.file,
    method: event.method,
    statusCode: event.statusCode,
    responseSize: event.responseSize,
    ts: event.ts,
    requestBodyIsBinary: event.requestBodyIsBinary,
    requestBodySize: event.requestBodySize,
    responseBodyIsBinary: event.responseBodyIsBinary
  }
}

/**
 * Хранилище лога трафика: полные события пишутся построчным JSON (JSONL) в файл сессии, в памяти
 * держится только лёгкий индекс (метаданные + ts). Тела и заголовки читаются из файла по запросу.
 * Каждый запуск приложения — новый файл traffic-<timestamp>.jsonl, старые файлы не трогаются.
 * Кнопка «очистить» в UI чистит только отображение в renderer — файл на диске остаётся целиком.
 */
class LogStore {
  private readonly dir = join(app.getPath('userData'), 'traffic-logs')
  private readonly filePath = join(this.dir, `traffic-${Date.now()}.jsonl`)
  private stream: WriteStream | null = null
  // индекс всех записей файла: метаданные для списка/поиска + ts как ключ для getEvent
  private index: LogEntryMeta[] = []

  private ensureStream(): WriteStream {
    if (!this.stream) {
      mkdirSync(this.dir, { recursive: true })
      this.stream = createWriteStream(this.filePath, { flags: 'a' })
    }
    return this.stream
  }

  /** Дописывает пачку событий в файл, возвращает их лёгкие версии для отправки в renderer */
  appendBatch(events: ProxyLogEvent[]): LogEntryMeta[] {
    if (events.length === 0) return []
    const stream = this.ensureStream()
    const metas: LogEntryMeta[] = []
    for (const event of events) {
      stream.write(`${JSON.stringify(event)}\n`)
      const meta = toMeta(event)
      this.index.push(meta)
      metas.push(meta)
    }
    return metas
  }

  /** Одно событие лога, записанное с этим ts (парсит файл — деталь смотрят редко, по одному) */
  getEvent(ts: number): ProxyLogEvent | null {
    return this.readAll().find((e) => e.ts === ts) ?? null
  }

  /** Все полные события файла лога — для экспорта */
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
    return this.index.slice(-RECENT_LIMIT)
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
      // поиск по телу — читаем файл целиком (редкое действие, дешевле чем держать тела в памяти)
      for (const line of this.readLines()) {
        try {
          const event = JSON.parse(line) as ProxyLogEvent
          if (matchedTs.has(event.ts)) continue
          if (event.requestBody.toLowerCase().includes(q) || event.responseBody.toLowerCase().includes(q)) {
            matchedTs.add(event.ts)
          }
        } catch {
          // битая строка
        }
      }
    }

    return this.index.filter((m) => matchedTs.has(m.ts))
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
