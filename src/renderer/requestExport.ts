import type { ProxyLogEvent } from '../shared/types'

// заголовки соединения/кодирования, которые не нужны в сгенерированном запросе — они относятся
// к исходному TCP/TLS-соединению и только сломают повтор (Content-Length будет неверным после
// перекодирования, Host мешает клиенту резолвить хост из URL)
const SKIPPED_HEADERS = new Set(['host', 'content-length', 'connection', 'accept-encoding'])

function usefulHeaders(event: ProxyLogEvent): [string, string][] {
  return Object.entries(event.requestHeaders).filter(([name]) => !SKIPPED_HEADERS.has(name.toLowerCase()))
}

function hasBody(event: ProxyLogEvent): boolean {
  return !!event.requestBody && !event.requestBodyIsBinary && !['GET', 'HEAD'].includes(event.method.toUpperCase())
}

/** Экранирование одинарных кавычек для POSIX-shell single-quoted строки */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** curl-команда для терминала (POSIX-shell) */
function toCurl(event: ProxyLogEvent): string {
  const parts = [`curl ${shellSingleQuote(event.url)}`]
  if (event.method.toUpperCase() !== 'GET') {
    parts.push(`  -X ${event.method.toUpperCase()}`)
  }
  for (const [name, value] of usefulHeaders(event)) {
    parts.push(`  -H ${shellSingleQuote(`${name}: ${value}`)}`)
  }
  if (hasBody(event)) {
    parts.push(`  --data-raw ${shellSingleQuote(event.requestBody)}`)
  }
  return parts.join(' \\\n')
}

/** fetch(...) для браузера / Node 18+ (тот же формат, что копирует Chrome DevTools) */
function toFetch(event: ProxyLogEvent): string {
  const init: Record<string, unknown> = {
    method: event.method.toUpperCase(),
    headers: Object.fromEntries(usefulHeaders(event))
  }
  if (hasBody(event)) {
    init.body = event.requestBody
  }
  return `fetch(${JSON.stringify(event.url)}, ${JSON.stringify(init, null, 2)});`
}

/** PowerShell Invoke-WebRequest */
function toPowerShell(event: ProxyLogEvent): string {
  const psQuote = (value: string): string => `'${value.replace(/'/g, "''")}'`
  const headerPairs = usefulHeaders(event)
    .map(([name, value]) => `  ${psQuote(name)} = ${psQuote(value)}`)
    .join('\n')
  const parts = [`$headers = @{\n${headerPairs}\n}`, '', `Invoke-WebRequest -Uri ${psQuote(event.url)} \``]
  parts.push(`  -Method ${event.method.toUpperCase()} \``)
  parts.push('  -Headers $headers' + (hasBody(event) ? ' `' : ''))
  if (hasBody(event)) {
    parts.push(`  -Body ${psQuote(event.requestBody)}`)
  }
  return parts.join('\n')
}

export type RequestFormat = 'curl' | 'fetch' | 'powershell'

export const REQUEST_FORMAT_LABELS: Record<RequestFormat, string> = {
  curl: 'cURL',
  fetch: 'fetch (JS / Node)',
  powershell: 'PowerShell'
}

/** Готовый запрос в выбранном формате — вставляется и работает как есть */
export function buildRequest(event: ProxyLogEvent, format: RequestFormat): string {
  switch (format) {
    case 'curl':
      return toCurl(event)
    case 'fetch':
      return toFetch(event)
    case 'powershell':
      return toPowerShell(event)
  }
}
