import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { createServer, request, type Server } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import { connect as tlsConnect } from 'tls'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'net'
import type { ProxyLogEvent, Rule } from '../../shared/types'

// CA создаётся во временном каталоге, а не в настоящем ~/.mitmproxy
const fakeHome = mkdtempSync(join(tmpdir(), 'fs-proxy-home-'))
vi.mock('os', async (importOriginal) => {
  const original = await importOriginal<typeof import('os')>()
  return { ...original, homedir: () => fakeHome }
})

const { ProxyServer, BODY_CAPTURE_LIMIT_BYTES } = await import('./proxyServer')
const { CA_CERT_PATH } = await import('./certificateAuthority')

const workDir = mkdtempSync(join(tmpdir(), 'fs-proxy-'))
const rulesFile = join(workDir, 'rules.json')
const swapFile = join(workDir, 'swap.js')
const logs: ProxyLogEvent[] = []

let upstream: Server
let upstreamPort: number
let proxy: InstanceType<typeof ProxyServer>
let proxyPort: number

function writeRules(rules: Partial<Rule>[]): void {
  writeFileSync(rulesFile, JSON.stringify({ rules }))
}

/** Обычный HTTP-запрос через прокси (absolute-form URL) */
function httpViaProxy(
  url: string,
  method = 'GET',
  body = ''
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: proxyPort, method, path: url, headers: { host: new URL(url).host } },
      (res) => {
        let text = ''
        res.setEncoding('utf-8')
        res.on('data', (chunk: string) => (text += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }))
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

/** HTTPS-запрос через CONNECT-туннель с проверкой сертификата по CA прокси */
function httpsViaProxy(host: string, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const connectRequest = request({ host: '127.0.0.1', port: proxyPort, method: 'CONNECT', path: `${host}:443` })
    connectRequest.on('error', reject)
    connectRequest.on('connect', (_res, socket) => {
      const tlsSocket = tlsConnect({ socket, servername: host, ca: readFileSync(CA_CERT_PATH) }, () => {
        tlsSocket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`)
      })
      let raw = ''
      tlsSocket.setEncoding('utf-8')
      tlsSocket.on('data', (chunk: string) => (raw += chunk))
      tlsSocket.on('end', () => resolve(raw))
      tlsSocket.on('error', reject)
    })
    connectRequest.end()
  })
}

beforeAll(async () => {
  upstream = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'X-Upstream': 'yes', 'Set-Cookie': 'secret=1' })
      res.end(`upstream ${req.method} ${req.url} ${req.headers['x-added'] ?? ''} ${body.length}`)
    })
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  upstreamPort = (upstream.address() as AddressInfo).port

  writeFileSync(swapFile, 'console.log("swapped")')
  writeRules([])
  proxy = new ProxyServer(
    rulesFile,
    (event) => logs.push(event),
    () => {}
  )
  await proxy.listen('127.0.0.1', 0)
  proxyPort = ((proxy as unknown as { outerServer: Server }).outerServer.address() as AddressInfo).port
})

afterAll(() => {
  proxy.close()
  upstream.close()
})

describe('ProxyServer', () => {
  it('подменяет ответ локальным файлом по точному URL', async () => {
    const url = `http://127.0.0.1:${upstreamPort}/app.js`
    writeRules([{ id: 'swap', enabled: true, urlPattern: url, isRegex: false, localFilePath: swapFile }])

    const response = await httpViaProxy(url)

    expect(response.status).toBe(200)
    expect(response.body).toBe('console.log("swapped")')
    expect(response.headers['content-type']).toBe('text/javascript')
    expect(response.headers['cache-control']).toBe('no-store')
    const entry = logs.at(-1)
    expect(entry).toMatchObject({ event: 'matched', url, file: swapFile, statusCode: 200 })
  })

  it('пропускает запрос на сервер, применяя заголовки и статус из правила', async () => {
    const url = `http://127.0.0.1:${upstreamPort}/api/items`
    writeRules([
      {
        id: 'headers',
        enabled: true,
        urlPattern: '/api/',
        isRegex: true,
        requestHeaderOverrides: [{ name: 'X-Added', value: 'from-rule' }],
        responseHeaderOverrides: [{ name: 'X-Upstream', value: '' }],
        statusCodeOverride: 418
      }
    ])
    await new Promise((resolve) => setTimeout(resolve, 1_100))

    const response = await httpViaProxy(url, 'POST', 'a'.repeat(BODY_CAPTURE_LIMIT_BYTES + 1))

    expect(response.status).toBe(418)
    expect(response.body).toBe(`upstream POST /api/items from-rule ${BODY_CAPTURE_LIMIT_BYTES + 1}`)
    expect(response.headers['x-upstream']).toBeUndefined()
    const entry = logs.at(-1)
    expect(entry).toMatchObject({ event: 'matched', url, file: '', statusCode: 418 })
    expect(entry?.requestBody).toHaveLength(BODY_CAPTURE_LIMIT_BYTES)
    expect(entry?.requestBodySize).toBe(BODY_CAPTURE_LIMIT_BYTES + 1)
    expect(entry?.responseHeaders['Set-Cookie']).toBe('<redacted by FileSwitcher>')
  })

  it('перехватывает HTTPS: сертификат хоста подписан CA прокси, ответ подменён', async () => {
    writeRules([
      { id: 'tls', enabled: true, urlPattern: 'https://example.test/', isRegex: false, responseBody: '{"ok":true}' }
    ])
    await new Promise((resolve) => setTimeout(resolve, 1_100))

    const raw = await httpsViaProxy('example.test', '/')

    expect(raw.startsWith('HTTP/1.1 200')).toBe(true)
    expect(raw.endsWith('{"ok":true}')).toBe(true)
    expect(logs.at(-1)).toMatchObject({ event: 'matched', url: 'https://example.test/' })
  })

  it('без правила пропускает трафик насквозь', async () => {
    const url = `http://127.0.0.1:${upstreamPort}/plain`
    writeRules([])
    await new Promise((resolve) => setTimeout(resolve, 1_100))

    const response = await httpViaProxy(url)

    expect(response.body).toBe('upstream GET /plain  0')
    expect(logs.at(-1)).toMatchObject({ event: 'passed', url, statusCode: 200 })
  })
})
