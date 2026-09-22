import { isIP } from 'net'
import { lookup } from 'dns/promises'
import { redactHeaders } from '../shared/redactedHeaders'
import type { ProxyLogEvent } from '../shared/types'

const REPLAY_TIMEOUT_MS = 15_000
const MAX_REPLAY_REDIRECTS = 5

// ответ replay читается с потолком: без него endpoint, отдающий сотни мегабайт, качался бы целиком
// в память main-процесса (и ещё раз копировался при JSON.stringify в лог) — OOM всего приложения
const MAX_REPLAY_BODY_BYTES = 8 * 1024 * 1024

/** Читает тело ответа с потолком MAX_REPLAY_BODY_BYTES; при превышении обрывает загрузку
 * (reader.cancel) и помечает текст маркером обрезки */
async function readBoundedText(response: Response): Promise<{ text: string; size: number }> {
  const body = response.body
  if (!body) return { text: '', size: 0 }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (size + value.byteLength > MAX_REPLAY_BODY_BYTES) {
        truncated = true
        break
      }
      chunks.push(value)
      size += value.byteLength
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => undefined)
  }
  let text = Buffer.concat(chunks).toString('utf-8')
  if (truncated) text += `\n… [обрезано FileSwitcher: ответ больше ${MAX_REPLAY_BODY_BYTES} байт]`
  return { text, size }
}

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

/** true для loopback, link-local, приватных и прочих не-публичных диапазонов IPv4/IPv6 —
 * replay на такие адреса дал бы renderer доступ к локальным и внутрикорпоративным сервисам
 * в обход CSP и браузерного CORS */
function isNonPublicAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true // link-local
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    if (a >= 224) return true // multicast + reserved
    return false
  }
  if (family === 6) {
    const addr = ip.toLowerCase().replace(/^\[|\]$/g, '')
    if (addr === '::1' || addr === '::') return true
    if (addr.startsWith('fe80')) return true // link-local
    if (addr.startsWith('fc') || addr.startsWith('fd')) return true // unique local
    if (addr.startsWith('ff')) return true // multicast
    // IPv4-mapped (::ffff:a.b.c.d) — проверяем встроенный IPv4
    const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isNonPublicAddress(mapped[1])
    return false
  }
  return true
}

/** Отклоняет замену на приватный/loopback хост до отправки запроса */
async function assertPublicTarget(rawUrl: string): Promise<void> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`Некорректный URL для повтора: ${rawUrl}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Повтор поддерживает только http/https, получено: ${url.protocol}`)
  }

  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) {
    if (isNonPublicAddress(host)) throw new Error(`Повтор на локальный/приватный адрес запрещён: ${host}`)
    return
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('Повтор на localhost запрещён')
  }

  const resolved = await lookup(host, { all: true }).catch(() => {
    throw new Error(`Не удалось разрешить хост ${host}`)
  })
  for (const { address } of resolved) {
    if (isNonPublicAddress(address)) {
      throw new Error(`Хост ${host} резолвится в локальный/приватный адрес ${address}`)
    }
  }
}

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

  await assertPublicTarget(event.url)

  const headers = new Headers()
  for (const [name, value] of Object.entries(event.requestHeaders)) {
    if (SKIPPED_REPLAY_HEADERS.has(name.toLowerCase())) continue
    headers.set(name, value)
  }

  const hasBody = Boolean(event.requestBody)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REPLAY_TIMEOUT_MS)
  try {
    // редиректы отслеживаем вручную: undici при follow не проверяет приватность нового хоста,
    // поэтому сервер мог бы увести replay на 127.0.0.1 или внутрикорпоративный адрес
    let currentUrl = event.url
    let method = event.method
    let response: Response
    for (let hop = 0; ; hop++) {
      const sendBody = hasBody && !['GET', 'HEAD'].includes(method.toUpperCase())
      response = await fetch(currentUrl, {
        method,
        headers,
        body: sendBody ? event.requestBody : undefined,
        redirect: 'manual',
        signal: controller.signal
      })
      if (response.status < 300 || response.status >= 400) break
      const location = response.headers.get('location')
      if (!location) break
      if (hop >= MAX_REPLAY_REDIRECTS) throw new Error(`Превышен лимит редиректов (${MAX_REPLAY_REDIRECTS})`)
      currentUrl = new URL(location, currentUrl).toString()
      await assertPublicTarget(currentUrl)
      // 301/302/303 на POST превращают запрос в GET без тела — как это делают браузеры
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method !== 'GET')) {
        method = 'GET'
      }
    }
    const { text: responseBody, size: responseSize } = await readBoundedText(response)
    return {
      event: 'replay',
      url: event.url,
      file: '',
      method: event.method,
      statusCode: response.status,
      requestHeaders: redactHeaders(event.requestHeaders),
      // обычный трафик редактирует секретные заголовки в addon.py, а replay идёт мимо аддона —
      // без этой строки свежий Set-Cookie/X-Auth-Token от сервера попал бы в лог и экспорт открытым
      responseHeaders: redactHeaders(Object.fromEntries(response.headers.entries())),
      responseSize,
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
