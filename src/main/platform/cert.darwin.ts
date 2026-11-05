import { existsSync } from 'fs'
import { execAsync } from '../execAsync'
import { CA_CERT_PATH, ensureCaExists } from '../proxy/certificateAuthority'
import type { CertManager } from './types'
import type { CertStatus } from '../../shared/types'

class DarwinCertManager implements CertManager {
  readonly caCertPath = CA_CERT_PATH

  private assertCertExists(hint: string): void {
    if (!existsSync(CA_CERT_PATH)) {
      throw new Error(`Сертификат не найден: ${CA_CERT_PATH}${hint}`)
    }
  }

  /** Проверяет, доверен ли CA-сертификат прокси как root в системе текущего пользователя */
  async status(): Promise<CertStatus> {
    if (!existsSync(CA_CERT_PATH)) {
      return 'not-generated'
    }

    try {
      // exit code 0 — сертификат успешно верифицируется как доверенный root,
      // ненулевой (обычно CSSMERR_TP_NOT_TRUSTED) — доверия нет
      await execAsync('security', ['verify-cert', '-c', CA_CERT_PATH, '-l'])
      return 'trusted'
    } catch {
      return 'not-trusted'
    }
  }

  /**
   * Устанавливает доверие к CA-сертификату прокси (создав его при необходимости) в user keychain текущего пользователя.
   * Без флага -d (admin/system store), поэтому macOS сам запрашивает пароль/Touch ID
   * через системный диалог — эскалация через sudo для user-домена не нужна и не работает
   * (SecTrustSettingsSetTrustSettings отказывает без полноценного GUI-авторизационного контекста).
   */
  async install(): Promise<void> {
    ensureCaExists()
    await execAsync('security', ['add-trusted-cert', '-r', 'trustRoot', CA_CERT_PATH])
  }

  /** Убирает доверие к CA-сертификату прокси из user keychain (сам файл сертификата не удаляет) */
  async removeTrust(): Promise<void> {
    this.assertCertExists('')
    await execAsync('security', ['remove-trusted-cert', CA_CERT_PATH])
  }
}

export const darwinCert = new DarwinCertManager()
