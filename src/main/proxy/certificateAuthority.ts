import { generateKeyPairSync, randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { isIP } from 'net'
import { createSecureContext, type SecureContext } from 'tls'
import forge from 'node-forge'

// каталог и имена файлов совпадают с mitmproxy: CA, которому система уже доверяет со времён
// Python-движка, продолжает работать без повторной установки
const CA_DIR = join(homedir(), '.mitmproxy')
/** Ключ и сертификат CA в одном PEM */
const CA_KEY_AND_CERT_PATH = join(CA_DIR, 'mitmproxy-ca.pem')
/** Только сертификат CA — его добавляют в доверенные */
export const CA_CERT_PATH = join(CA_DIR, 'mitmproxy-ca-cert.pem')

const CA_VALIDITY_YEARS = 10
// macOS не принимает серверные сертификаты дольше 825 дней даже от пользовательского root
const LEAF_VALIDITY_DAYS = 365
// хостов за сессию обычно десятки; потолок не даёт кэшу расти бесконечно
const MAX_CACHED_CONTEXTS = 1_000

interface CaMaterial {
  key: forge.pki.rsa.PrivateKey
  cert: forge.pki.Certificate
}

/** Случайный положительный серийный номер в hex */
function randomSerial(): string {
  const bytes = randomBytes(16)
  bytes[0] &= 0x7f
  return bytes.toString('hex')
}

/** Создаёт RSA-ключ нативным crypto: forge генерирует его на чистом JS в разы медленнее */
function generateRsaKey(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  })
  return { privateKeyPem: privateKey, publicKeyPem: publicKey }
}

/** Создаёт CA и сохраняет его в ~/.mitmproxy, если там ещё ничего нет */
export function ensureCaExists(): void {
  if (existsSync(CA_KEY_AND_CERT_PATH)) return

  const { privateKeyPem, publicKeyPem } = generateRsaKey()
  const key = forge.pki.privateKeyFromPem(privateKeyPem) as forge.pki.rsa.PrivateKey
  const cert = forge.pki.createCertificate()
  cert.publicKey = forge.pki.publicKeyFromPem(publicKeyPem)
  cert.serialNumber = randomSerial()
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000)
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + CA_VALIDITY_YEARS)
  const subject = [
    { name: 'commonName', value: 'FileSwitcher CA' },
    { name: 'organizationName', value: 'FileSwitcher' }
  ]
  cert.setSubject(subject)
  cert.setIssuer(subject)
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' }
  ])
  cert.sign(key, forge.md.sha256.create())

  const certPem = forge.pki.certificateToPem(cert)
  mkdirSync(CA_DIR, { recursive: true })
  writeFileSync(CA_KEY_AND_CERT_PATH, privateKeyPem + certPem, { mode: 0o600 })
  writeFileSync(CA_CERT_PATH, certPem)
}

/** Загружает CA из ~/.mitmproxy (создавая его при первом запуске) */
function loadCa(): CaMaterial {
  ensureCaExists()
  const pem = readFileSync(CA_KEY_AND_CERT_PATH, 'utf-8')
  const keyBlock = pem.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----/)
  const certBlock = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)
  if (!keyBlock || !certBlock) throw new Error(`В ${CA_KEY_AND_CERT_PATH} нет ключа или сертификата CA`)
  return {
    key: forge.pki.privateKeyFromPem(keyBlock[0]) as forge.pki.rsa.PrivateKey,
    cert: forge.pki.certificateFromPem(certBlock[0])
  }
}

/**
 * Выпускает сертификаты под перехватываемые хосты, подписанные CA. Один ключ на все хосты
 * (как у mitmproxy) — генерация RSA-ключа дорогая, а подпись сертификата — нет.
 */
export class CertificateAuthority {
  private readonly ca = loadCa()
  private readonly leafKeyPem: string
  private readonly leafPublicKey: forge.pki.PublicKey
  private readonly contexts = new Map<string, SecureContext>()

  constructor() {
    const { privateKeyPem, publicKeyPem } = generateRsaKey()
    this.leafKeyPem = privateKeyPem
    this.leafPublicKey = forge.pki.publicKeyFromPem(publicKeyPem)
  }

  /** TLS-контекст с сертификатом для хоста (кэшируется) */
  contextFor(host: string): SecureContext {
    const cached = this.contexts.get(host)
    if (cached) return cached

    if (this.contexts.size >= MAX_CACHED_CONTEXTS) this.contexts.clear()
    const context = createSecureContext({ key: this.leafKeyPem, cert: this.issueCertificatePem(host) })
    this.contexts.set(host, context)
    return context
  }

  private issueCertificatePem(host: string): string {
    const cert = forge.pki.createCertificate()
    cert.publicKey = this.leafPublicKey
    cert.serialNumber = randomSerial()
    cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000)
    cert.validity.notAfter = new Date(Date.now() + LEAF_VALIDITY_DAYS * 24 * 60 * 60 * 1000)
    cert.setSubject([{ name: 'commonName', value: host }])
    cert.setIssuer(this.ca.cert.subject.attributes)
    const altName = isIP(host) ? { type: 7, ip: host } : { type: 2, value: host }
    cert.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [altName] }
    ])
    cert.sign(this.ca.key, forge.md.sha256.create())
    return forge.pki.certificateToPem(cert)
  }
}
