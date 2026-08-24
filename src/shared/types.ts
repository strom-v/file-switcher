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
}

/** Активный VPN, обнаруженный на машине. named — зарегистрированный network service (управляем прокси на нём через networksetup); безымянные (WireGuard и т.п., видны только как utun-интерфейс) управлению не поддаются, только индикация. */
export interface VpnService {
  name: string | null
  allowed: boolean
}

export type CertStatus = 'not-generated' | 'not-trusted' | 'trusted'

export interface CertInfo {
  sha1: string
  expiresAt: string
  trusted: boolean
}
