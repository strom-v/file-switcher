import { homedir } from 'os'
import { existsSync } from 'fs'
import { join } from 'path'
import { execAsync } from '../execAsync'
import type { CertManager } from './types'
import type { CertInfo, CertStatus } from '../../shared/types'

// certutil бывает заметно медленнее networksetup/security (обращается к CryptoAPI, иногда к сети);
// 0 = без таймаута для install (там свой диалог подтверждения Windows), 30с для чтения
const CERTUTIL_READ_TIMEOUT_MS = 30_000

// mitmproxy на Windows кладёт CA туда же (~/.mitmproxy/) и генерирует и .pem, и .cer (DER).
// certutil удобнее работает с .cer, но принимает и .pem
const CA_DIR = join(homedir(), '.mitmproxy')
const CA_CERT_CER = join(CA_DIR, 'mitmproxy-ca-cert.cer')
const CA_CERT_PEM = join(CA_DIR, 'mitmproxy-ca-cert.pem')

function resolveCaCertPath(): string {
  return existsSync(CA_CERT_CER) ? CA_CERT_CER : CA_CERT_PEM
}

/** SHA1-отпечатки всех сертификатов CN=mitmproxy в пользовательском хранилище Root */
async function listStoreThumbprints(): Promise<string[]> {
  let output: string
  try {
    output = await execAsync('certutil', ['-store', '-user', 'Root', 'mitmproxy'], CERTUTIL_READ_TIMEOUT_MS)
  } catch {
    return []
  }
  // строки вида: "Cert Hash(sha1): 1a 2b 3c ..." (в разных локалях подпись может отличаться,
  // но hex-группа из 20 байт узнаётся надёжно)
  const matches = output.matchAll(/(?:Cert Hash\(sha1\)|Хэш сертификата\(sha1\)):\s*([0-9a-f ]{40,})/gi)
  return [...matches].map((m) => m[1].replace(/\s+/g, '').toUpperCase())
}

/** Есть ли в выводе certutil -verify признак успешной цепочки доверия */
function isVerifyOk(output: string): boolean {
  // certutil при доверенной цепочке пишет "CERT_TRUST_NO_ERROR" и/или "successfully verified"
  return /CERT_TRUST_NO_ERROR|successfully verified|успешно проверен/i.test(output)
}

class Win32CertManager implements CertManager {
  get caCertPath(): string {
    return resolveCaCertPath()
  }

  async status(): Promise<CertStatus> {
    if (!existsSync(CA_CERT_CER) && !existsSync(CA_CERT_PEM)) {
      return 'not-generated'
    }
    // сертификат физически в пользовательском Root-хранилище?
    const thumbprints = await listStoreThumbprints()
    if (thumbprints.length === 0) {
      return 'not-trusted'
    }
    // проверяем, что цепочка реально валидируется (сертификат в сторе, не отозван, не истёк)
    try {
      const output = await execAsync('certutil', ['-verify', this.caCertPath], CERTUTIL_READ_TIMEOUT_MS)
      return isVerifyOk(output) ? 'trusted' : 'not-trusted'
    } catch {
      return 'not-trusted'
    }
  }

  /** Добавляет CA в пользовательское хранилище Root. Windows показывает свой диалог подтверждения. */
  async install(): Promise<void> {
    if (!existsSync(this.caCertPath)) {
      throw new Error(`Сертификат не найден: ${this.caCertPath}. Сначала запустите прокси и откройте http://mitm.it`)
    }
    // 0 = без таймаута: Windows показывает свой диалог подтверждения корневого сертификата
    await execAsync('certutil', ['-addstore', '-user', 'Root', this.caCertPath], 0)
  }

  async removeTrust(): Promise<void> {
    const thumbprints = await listStoreThumbprints()
    if (thumbprints.length === 0) return
    // удаляем по каждому отпечатку — их может накопиться несколько после переустановок mitmproxy
    for (const thumbprint of thumbprints) {
      await execAsync('certutil', ['-delstore', '-user', 'Root', thumbprint], CERTUTIL_READ_TIMEOUT_MS)
    }
  }

  async list(): Promise<CertInfo[]> {
    let output: string
    try {
      output = await execAsync('certutil', ['-store', '-user', 'Root', 'mitmproxy'], CERTUTIL_READ_TIMEOUT_MS)
    } catch {
      return []
    }

    // certutil разделяет записи строкой "================ Certificate N ================"
    const blocks = output.split(/=+\s*Certificate\s+\d+\s*=+/i).filter((b) => b.trim())
    return blocks
      .map((block) => {
        const sha1 = block.match(/(?:Cert Hash\(sha1\)|Хэш сертификата\(sha1\)):\s*([0-9a-f ]{40,})/i)?.[1]
        const notAfter = block.match(/NotAfter:\s*(.+)/i)?.[1]
        if (!sha1) return null
        return {
          sha1: sha1.replace(/\s+/g, '').toUpperCase(),
          expiresAt: notAfter?.trim() ?? '',
          // подробную проверку доверия на каждый сертификат не гоняем (дорого) — раз он в
          // user Root store, считаем доверенным; общий статус даёт status()
          trusted: true
        }
      })
      .filter((c): c is CertInfo => c !== null)
  }
}

export const win32Cert = new Win32CertManager()
