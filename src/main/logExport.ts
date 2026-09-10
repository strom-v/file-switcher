import { createReadStream, createWriteStream, existsSync } from 'fs'
import { once } from 'events'
import { createInterface } from 'readline'
import { finished } from 'stream/promises'
import { Readable } from 'stream'
import type { ProxyLogEvent } from '../shared/types'

export type LogExportFormat = 'har' | 'json' | 'csv'

const iso = (ts: number): string => new Date(ts * 1000).toISOString()

function toHarHeaders(headers: Record<string, string>): { name: string; value: string }[] {
  return Object.entries(headers).map(([name, value]) => ({ name, value }))
}

/** Одна запись лога → HAR entry (1.2). Точные тайминги/размеры недоступны — 0/-1, как принято
 * у HAR-генераторов без доступа к сырому трафику; тела кладём как text, если это не бинарь */
function toHarEntry(event: ProxyLogEvent): object {
  const mimeType = event.responseHeaders['Content-Type'] ?? event.responseHeaders['content-type'] ?? ''
  return {
    startedDateTime: iso(event.ts),
    time: 0,
    request: {
      method: event.method,
      url: event.url,
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: toHarHeaders(event.requestHeaders),
      queryString: [],
      headersSize: -1,
      bodySize: event.requestBodySize,
      postData: event.requestBody && !event.requestBodyIsBinary ? { mimeType: '', text: event.requestBody } : undefined
    },
    response: {
      status: event.statusCode ?? 0,
      statusText: '',
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: toHarHeaders(event.responseHeaders),
      content: {
        size: event.responseSize,
        mimeType,
        text: event.responseBody && !event.responseBodyIsBinary ? event.responseBody : undefined
      },
      redirectURL: '',
      headersSize: -1,
      bodySize: event.responseSize
    },
    cache: {},
    timings: { send: 0, wait: 0, receive: 0 },
    // нестандартные поля — общепринятое расширение (Chrome DevTools/Fiddler) для доп. контекста
    _fileSwitcherEvent: event.event,
    _fileSwitcherSubstitutedFile: event.file || undefined
  }
}

function buildHar(events: ProxyLogEvent[]): string {
  return JSON.stringify(
    { log: { version: '1.2', creator: { name: 'FileSwitcher', version: '0.1.0' }, entries: events.map(toHarEntry) } },
    null,
    2
  )
}

const CSV_COLUMNS = ['time', 'method', 'url', 'status', 'event', 'file', 'responseSize'] as const

function toCsvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Одна CSV-строка события */
function toCsvRow(event: ProxyLogEvent): string {
  return [iso(event.ts), event.method, event.url, event.statusCode ?? '', event.event, event.file, event.responseSize]
    .map(toCsvCell)
    .join(',')
}

function buildCsv(events: ProxyLogEvent[]): string {
  const rows = events.map(toCsvRow)
  return [CSV_COLUMNS.join(','), ...rows].join('\n')
}

/** Записывает chunk с учётом backpressure выходного потока */
async function writeChunk(output: ReturnType<typeof createWriteStream>, chunk: string): Promise<void> {
  if (!output.write(chunk, 'utf-8')) await once(output, 'drain')
}

/** Добавляет общий отступ к многострочному JSON одного события */
function indentJson(value: unknown, spaces: number): string {
  const indent = ' '.repeat(spaces)
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n')
}

/** Потоково экспортирует JSONL-сессию прямо в выбранный файл */
export async function streamLogExport(
  sourcePath: string,
  destinationPath: string,
  format: LogExportFormat
): Promise<void> {
  // файла сессии ещё нет, если прокси ни разу не запускался — экспортируем пустой лог
  const input = existsSync(sourcePath)
    ? createReadStream(sourcePath, { encoding: 'utf-8' })
    : Readable.from([], { encoding: 'utf-8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  const output = createWriteStream(destinationPath, { encoding: 'utf-8' })
  let first = true

  try {
    if (format === 'json') await writeChunk(output, '[\n')
    if (format === 'har') {
      await writeChunk(
        output,
        '{\n  "log": {\n    "version": "1.2",\n    "creator": { "name": "FileSwitcher", "version": "0.1.0" },\n    "entries": [\n'
      )
    }
    if (format === 'csv') await writeChunk(output, CSV_COLUMNS.join(','))

    for await (const line of lines) {
      let event: ProxyLogEvent
      try {
        event = JSON.parse(line) as ProxyLogEvent
      } catch {
        continue
      }

      if (format === 'csv') {
        await writeChunk(output, `\n${toCsvRow(event)}`)
        continue
      }

      if (!first) await writeChunk(output, ',\n')
      await writeChunk(output, indentJson(format === 'har' ? toHarEntry(event) : event, format === 'har' ? 6 : 2))
      first = false
    }

    if (format === 'json') await writeChunk(output, '\n]\n')
    if (format === 'har') await writeChunk(output, '\n    ]\n  }\n}\n')
    if (format === 'csv') await writeChunk(output, '\n')
    output.end()
    await finished(output)
  } catch (error) {
    output.destroy()
    throw error
  } finally {
    lines.close()
    input.destroy()
  }
}

/** Сериализует события лога в выбранный формат */
export function buildLogExport(events: ProxyLogEvent[], format: LogExportFormat): string {
  if (format === 'har') return buildHar(events)
  if (format === 'csv') return buildCsv(events)
  return JSON.stringify(events, null, 2)
}
