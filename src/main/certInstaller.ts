import { homedir, tmpdir } from 'os'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execAsync } from './execAsync'

import type { CertInfo, CertStatus } from '../shared/types'

export type { CertInfo, CertStatus } from '../shared/types'

const CA_CERT_PATH = join(homedir(), '.mitmproxy', 'mitmproxy-ca-cert.pem')
const LOGIN_KEYCHAIN = join(homedir(), 'Library', 'Keychains', 'login.keychain-db')

/** Бросает, если CA-сертификат mitmproxy ещё не сгенерирован */
function assertCertExists(hint: string): void {
  if (!existsSync(CA_CERT_PATH)) {
    throw new Error(`Сертификат не найден: ${CA_CERT_PATH}${hint}`)
  }
}

/** Проверяет, доверен ли CA-сертификат mitmproxy как root в системе текущего пользователя */
export async function getCertStatus(): Promise<CertStatus> {
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
 * Устанавливает доверие к CA-сертификату mitmproxy в user keychain текущего пользователя.
 * Без флага -d (admin/system store), поэтому macOS сам запрашивает пароль/Touch ID
 * через системный диалог — эскалация через sudo для user-домена не нужна и не работает
 * (SecTrustSettingsSetTrustSettings отказывает без полноценного GUI-авторизационного контекста).
 */
export async function installCert(): Promise<void> {
  assertCertExists('. Сначала запустите прокси и откройте http://mitm.it')

  await execAsync('security', ['add-trusted-cert', '-r', 'trustRoot', CA_CERT_PATH])
}

/** Убирает доверие к CA-сертификату mitmproxy из user keychain (сам файл сертификата не удаляет) */
export async function removeCertTrust(): Promise<void> {
  assertCertExists('')

  await execAsync('security', ['remove-trusted-cert', CA_CERT_PATH])
}

/**
 * Перечисляет все сертификаты с CN=mitmproxy в user keychain (их может накопиться
 * несколько после переустановок mitmproxy) с сроком действия и статусом доверия каждого.
 */
export async function listCerts(): Promise<CertInfo[]> {
  let output: string
  try {
    output = await execAsync('security', ['find-certificate', '-a', '-c', 'mitmproxy', '-Z', '-p', LOGIN_KEYCHAIN])
  } catch {
    return []
  }

  const blocks = output.split(/(?=SHA-1 hash: )/).filter((b) => b.trim())
  const tmpDir = mkdtempSync(join(tmpdir(), 'filewitcher-certs-'))

  try {
    const parsedBlocks = blocks
      .map((block) => ({
        sha1: block.match(/SHA-1 hash:\s*([0-9A-F]+)/)?.[1],
        pem: block.match(/-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/)?.[0]
      }))
      .filter((b): b is { sha1: string; pem: string } => !!b.sha1 && !!b.pem)

    const certs = await Promise.all(
      parsedBlocks.map(async ({ sha1, pem }) => {
        const certPath = join(tmpDir, `${sha1}.pem`)
        writeFileSync(certPath, pem)

        const expiresAt = (await execAsync('openssl', ['x509', '-in', certPath, '-noout', '-enddate']))
          .replace('notAfter=', '')
          .trim()

        let trusted = false
        try {
          await execAsync('security', ['verify-cert', '-c', certPath, '-l'])
          trusted = true
        } catch {
          trusted = false
        }

        return { sha1, expiresAt, trusted }
      })
    )
    return certs
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}
