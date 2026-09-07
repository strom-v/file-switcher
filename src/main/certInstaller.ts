import { platform } from './platform'
import type { CertInfo, CertStatus } from '../shared/types'

export type { CertInfo, CertStatus } from '../shared/types'

/** Проверяет, доверен ли CA-сертификат mitmproxy как root в системе текущего пользователя */
export function getCertStatus(): Promise<CertStatus> {
  return platform.cert.status()
}

/** Устанавливает доверие к CA-сертификату mitmproxy (реализация зависит от платформы) */
export function installCert(): Promise<void> {
  return platform.cert.install()
}

/** Убирает доверие к CA-сертификату mitmproxy (сам файл сертификата не удаляет) */
export function removeCertTrust(): Promise<void> {
  return platform.cert.removeTrust()
}

/** Перечисляет все сертификаты mitmproxy в хранилище со сроком действия и статусом доверия */
export function listCerts(): Promise<CertInfo[]> {
  return platform.cert.list()
}
