import { homedir } from 'os'
import { existsSync } from 'fs'
import { join } from 'path'
import type { CertManager, SystemProxyManager } from './types'
import type { CertInfo, CertStatus } from '../../shared/types'

const NOT_SUPPORTED = 'Эта платформа не поддерживается — доступен только сам прокси-сервер'

/** Заглушки для платформ без своей реализации (Linux и т.п.): прокси-сервер работает,
 * системная интеграция — нет. Пользователь направляет трафик на прокси вручную. */

export const unsupportedSystemProxy: SystemProxyManager = {
  isPasswordlessSetup: () => true,
  setUpPasswordless: async () => {},
  getVpnStatus: async () => ({ active: false, blocksProxy: false }),
  enable: async () => {
    throw new Error(NOT_SUPPORTED)
  },
  disable: async () => {},
  recoverStale: async () => {}
}

export const unsupportedCert: CertManager = {
  caCertPath: join(homedir(), '.mitmproxy', 'mitmproxy-ca-cert.pem'),
  status: async (): Promise<CertStatus> =>
    existsSync(join(homedir(), '.mitmproxy', 'mitmproxy-ca-cert.pem')) ? 'not-trusted' : 'not-generated',
  install: async () => {
    throw new Error(NOT_SUPPORTED)
  },
  removeTrust: async () => {
    throw new Error(NOT_SUPPORTED)
  },
  list: async (): Promise<CertInfo[]> => []
}
