/**
 * Общие типы для main, preload и renderer.
 */

export interface Rule {
  id: string
  enabled: boolean
  urlPattern: string
  isRegex: boolean
  localFilePath: string
  contentType?: string
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

export type CertStatus = 'not-generated' | 'not-trusted' | 'trusted'

export interface CertInfo {
  sha1: string
  expiresAt: string
  trusted: boolean
}
