import type { ProxyLogEvent } from '../shared/types'

const REPLAY_TIMEOUT_MS = 15_000

// заголовки, которые либо запрещено выставлять вручную через fetch (forbidden request headers),
// либо описывают исходное соединение/кодирование и приведут к рассинхрону при повторной отправке
// (например Content-Length будет неверным, если тело перекодировалось; Host мешает fetch самому
// резолвить хост по URL)
const SKIPPED_REPLAY_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'accept-encoding',
  'cookie',
  'origin',
  'referer'
])

/** Повторяет запрос из лога напрямую на реальный сервер (не через локальный прокси — иначе
 * запрос снова попал бы в addon.py и, если правило матчит, снова получил бы подмену вместо
 * повторения оригинального запроса). Возвращает готовую запись лога (event: 'replay'), которую
 * renderer добавляет в список. Тело запроса в логе уже декодировано как текст, поэтому повторная
 * отправка бинарных тел исказит байты — вызывающий код не должен звать эту функцию для
 * requestBodyIsBinary: true (проверяется и здесь на всякий случай). */
export async function replayRequest(event: ProxyLogEvent): Promise<ProxyLogEvent> {
  if (event.requestBodyIsBinary) {
    throw new Error('Тело запроса бинарное — повторная отправка исказит данные')
  }

  const headers = new Headers()
  for (const [name, value] of Object.entries(event.requestHeaders)) {
    if (SKIPPED_REPLAY_HEADERS.has(name.toLowerCase())) continue
    headers.set(name, value)
  }

  const hasBody = !['GET', 'HEAD'].includes(event.method.toUpperCase()) && event.requestBody

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REPLAY_TIMEOUT_MS)
  try {
    const response = await fetch(event.url, {
      method: event.method,
      headers,
      body: hasBody ? event.requestBody : undefined,
      signal: controller.signal
    })
    const responseBody = await response.text()
    return {
      event: 'replay',
      url: event.url,
      file: '',
      method: event.method,
      statusCode: response.status,
      requestHeaders: event.requestHeaders,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      responseSize: Buffer.byteLength(responseBody, 'utf-8'),
      ts: Date.now() / 1000,
      requestBody: event.requestBody,
      requestBodyIsBinary: false,
      requestBodySize: event.requestBodySize,
      responseBody,
      responseBodyIsBinary: false
    }
  } catch (err) {
    // Node fetch (undici) всегда бросает generic "fetch failed" — настоящая причина
    // (DNS/TLS/ECONNREFUSED и т.п.) лежит в err.cause и без неё сообщение бесполезно для пользователя
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : null
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(cause ? `${message}: ${cause}` : message)
  } finally {
    clearTimeout(timeout)
  }
}
