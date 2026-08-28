/**
 * Общие типы для main, preload и renderer.
 */

/** Пара имя/значение заголовка; пустое value означает "удалить заголовок", если он есть в запросе/ответе */
export interface HeaderOverride {
  name: string
  value: string
}

export interface Rule {
  id: string
  enabled: boolean
  urlPattern: string
  isRegex: boolean
  /** пусто — запрос идёт на реальный сервер без подмены тела, применяются только остальные модификации ниже */
  localFilePath?: string
  contentType?: string
  requestHeaderOverrides?: HeaderOverride[]
  responseHeaderOverrides?: HeaderOverride[]
  /** задержка перед ответом в миллисекундах — эмуляция медленной сети */
  delayMs?: number
  /** подменяет HTTP-статус ответа (например для теста обработки ошибок 500/404) */
  statusCodeOverride?: number
}

export type ProxyStatus = 'stopped' | 'starting' | 'running' | 'crashed'

export interface ProxyState {
  status: ProxyStatus
  port: number
  error?: string
}

export type ProxyLogEventType = 'matched' | 'passed'

export interface ProxyLogEvent {
  event: ProxyLogEventType
  url: string
  file: string
  method: string
  statusCode: number | null
  requestHeaders: Record<string, string>
  responseHeaders: Record<string, string>
  responseSize: number
  ts: number
  /** тело запроса, декодировано как текст (errors=replace для бинарных данных) */
  requestBody: string
  /** true, если requestBody не является валидным UTF-8-текстом (картинка, шрифт и т.п.) */
  requestBodyIsBinary: boolean
  /** размер тела запроса в байтах (точный, в отличие от .length декодированной строки) */
  requestBodySize: number
  /** тело ответа, декодировано как текст (errors=replace для бинарных данных) */
  responseBody: string
  /** true, если responseBody не является валидным UTF-8-текстом (картинка, шрифт и т.п.) */
  responseBodyIsBinary: boolean
}

/** Результат повторной отправки запроса из лога (см. main/replayRequest.ts) */
export interface ReplayResult {
  statusCode: number
  headers: Record<string, string>
  body: string
}

export type CertStatus = 'not-generated' | 'not-trusted' | 'trusted'

export interface CertInfo {
  sha1: string
  expiresAt: string
  trusted: boolean
}
