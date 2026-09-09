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

function buildCsv(events: ProxyLogEvent[]): string {
  const rows = events.map((e) =>
    [iso(e.ts), e.method, e.url, e.statusCode ?? '', e.event, e.file, e.responseSize].map(toCsvCell).join(',')
  )
  return [CSV_COLUMNS.join(','), ...rows].join('\n')
}

/** Сериализует события лога в выбранный формат */
export function buildLogExport(events: ProxyLogEvent[], format: LogExportFormat): string {
  if (format === 'har') return buildHar(events)
  if (format === 'csv') return buildCsv(events)
  return JSON.stringify(events, null, 2)
}
