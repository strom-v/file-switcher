import { tsToDate } from './formatters'
import type { ProxyLogEvent } from '../shared/types'

/** Записи HTTP-заголовков в формате HAR (name/value вместо Record) */
function toHarHeaders(headers: Record<string, string>): { name: string; value: string }[] {
  return Object.entries(headers).map(([name, value]) => ({ name, value }))
}

/** Одна запись лога прокси → HAR entry (HAR 1.2). Точный httpVersion/размеры заголовков нам недоступны — используем -1 (не измерено), как принято у HAR-генераторов без доступа к сырому трафику. */
function toHarEntry(event: ProxyLogEvent): object {
  return {
    startedDateTime: tsToDate(event.ts).toISOString(),
    time: 0,
    request: {
      method: event.method,
      url: event.url,
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: toHarHeaders(event.requestHeaders),
      queryString: [],
      headersSize: -1,
      bodySize: -1
    },
    response: {
      status: event.statusCode ?? 0,
      statusText: '',
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: toHarHeaders(event.responseHeaders),
      content: {
        size: event.responseSize,
        mimeType: event.responseHeaders['Content-Type'] ?? event.responseHeaders['content-type'] ?? ''
      },
      redirectURL: '',
      headersSize: -1,
      bodySize: event.responseSize
    },
    cache: {},
    timings: { send: 0, wait: 0, receive: 0 },
    // не стандартное HAR-поле, но общепринятое расширение (Chrome DevTools/Fiddler) для доп. контекста
    _fileSwitcherEvent: event.event,
    _fileSwitcherSubstitutedFile: event.file || undefined
  }
}

/** Логи прокси → HAR 1.2 JSON-документ, читаемый Chrome DevTools/Fiddler/Charles и т.п. */
export function buildHar(logs: ProxyLogEvent[]): string {
  const har = {
    log: {
      version: '1.2',
      creator: { name: 'FileSwitcher', version: '0.1.0' },
      entries: logs.map(toHarEntry)
    }
  }
  return JSON.stringify(har, null, 2)
}
