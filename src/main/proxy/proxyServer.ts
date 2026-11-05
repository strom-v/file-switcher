import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { request as httpsRequest } from 'https'
import { connect as netConnect, type Socket } from 'net'
import { connect as tlsConnect, getCACertificates, TLSSocket } from 'tls'
import { setTimeout as sleep } from 'timers/promises'
import { Duplex } from 'stream'
import { redactHeaders } from '../../shared/redactedHeaders'
import type { ProxyLogEvent } from '../../shared/types'
import { CertificateAuthority } from './certificateAuthority'
import {
  applyHeaderOverrides,
  guessContentType,
  resolveSubstitutedPath,
  RuleMatcher,
  type RuleMatch
} from './ruleMatcher'

// сколько байт тела сохраняем в лог; бинарные тела не сохраняем вовсе — UI они не нужны
export const BODY_CAPTURE_LIMIT_BYTES = 64 * 1024
const MAX_LOG_HEADER_CHARS = 64 * 1024
const MAX_LOG_HEADER_COUNT = 100

const TLS_HANDSHAKE_RECORD = 0x16

// hop-by-hop заголовки описывают одно соединение и дальше не передаются (RFC 9110 §7.6.1)
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
])

// Node по умолчанию доверяет только своему набору CA; системные нужны для стендов с корпоративным CA
const UPSTREAM_CA = [...getCACertificates('default'), ...getCACertificates('system')]

/** Куда на самом деле идёт запрос: из CONNECT (https) или из absolute-form URL (http) */
interface Target {
  scheme: 'http' | 'https'
  host: string
  port: number
}

/** Тело, накопленное для лога: первые BODY_CAPTURE_LIMIT_BYTES байт и полный размер */
class BodyCapture {
  private readonly chunks: Buffer[] = []
  private captured = 0
  size = 0

  add(chunk: Buffer): void {
    this.size += chunk.length
    if (this.captured >= BODY_CAPTURE_LIMIT_BYTES) return
    const part = chunk.subarray(0, BODY_CAPTURE_LIMIT_BYTES - this.captured)
    this.chunks.push(part)
    this.captured += part.length
  }

  /** Текст тела и признак бинарности (тело не декодируется как UTF-8) */
  decode(): { text: string; isBinary: boolean } {
    if (this.size === 0) return { text: '', isBinary: false }
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(this.chunks)), isBinary: false }
    } catch {
      return { text: '', isBinary: true }
    }
  }
}

/** Пары [имя, значение] из rawHeaders без hop-by-hop заголовков */
function forwardableHeaders(rawHeaders: string[]): [string, string][] {
  const connectionListed = new Set<string>()
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index].toLowerCase() === 'connection') {
      for (const name of rawHeaders[index + 1].split(',')) connectionListed.add(name.trim().toLowerCase())
    }
  }
  const pairs: [string, string][] = []
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const lowerName = rawHeaders[index].toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lowerName) || connectionListed.has(lowerName)) continue
    pairs.push([rawHeaders[index], rawHeaders[index + 1]])
  }
  return pairs
}

/** Заголовки для лога: повторы склеены через запятую, число и объём ограничены */
function headersForLog(pairs: [string, string][]): Record<string, string> {
  const merged: Record<string, string> = {}
  const nameByLower = new Map<string, string>()
  for (const [name, value] of pairs) {
    const existing = nameByLower.get(name.toLowerCase())
    if (existing) {
      merged[existing] += `, ${value}`
      continue
    }
    nameByLower.set(name.toLowerCase(), name)
    merged[name] = value
  }

  const bounded: Record<string, string> = {}
  let usedChars = 0
  for (const [name, value] of Object.entries(merged).slice(0, MAX_LOG_HEADER_COUNT)) {
    const remaining = MAX_LOG_HEADER_CHARS - usedChars
    if (remaining <= 0) break
    const boundedName = name.slice(0, remaining)
    const boundedValue = value.slice(0, remaining - boundedName.length)
    bounded[boundedName] = boundedValue
    usedChars += boundedName.length + boundedValue.length
  }
  return redactHeaders(bounded)
}

/** Разбирает "host:port" и "[ipv6]:port" */
function parseAuthority(authority: string, defaultPort: number): { host: string; port: number } {
  const match = authority.match(/^\[([^\]]+)\](?::(\d+))?$/) ?? authority.match(/^([^:]+)(?::(\d+))?$/)
  if (!match) return { host: authority, port: defaultPort }
  return { host: match[1], port: match[2] ? Number(match[2]) : defaultPort }
}

/** URL в том виде, в каком его сравнивают с правилами: порт по умолчанию опускается */
function prettyUrl(target: Target, hostHeader: string | undefined, path: string): string {
  const defaultPort = target.scheme === 'https' ? 443 : 80
  const { host, port } = parseAuthority(hostHeader || target.host, target.port)
  const printedHost = host.includes(':') ? `[${host}]` : host
  const printedPort = port === defaultPort ? '' : `:${port}`
  return `${target.scheme}://${printedHost.toLowerCase()}${printedPort}${path}`
}

/**
 * Оборачивает сокет в Duplex, начиная с уже прочитанного первого куска. TLSSocket поверх
 * настоящего net.Socket читает прямо из нативного handle и не увидел бы этот кусок.
 */
function wrapSocket(socket: Socket, firstChunk: Buffer): Duplex {
  const stream = new Duplex({
    read() {
      socket.resume()
    },
    write(chunk: Buffer, _encoding, callback) {
      socket.write(chunk, callback)
    },
    final(callback) {
      socket.end(callback)
    },
    destroy(err, callback) {
      socket.destroy()
      callback(err)
    }
  })
  stream.push(firstChunk)
  socket.on('data', (chunk: Buffer) => {
    if (!stream.push(chunk)) socket.pause()
  })
  socket.on('end', () => stream.push(null))
  socket.on('close', () => stream.destroy())
  return stream
}

/** Читает тело запроса целиком (для подмены без обращения к серверу) */
async function drain(stream: IncomingMessage, capture: BodyCapture): Promise<void> {
  for await (const chunk of stream) capture.add(chunk as Buffer)
}

/**
 * HTTP(S)-прокси с перехватом TLS: CONNECT-туннели терминируются сертификатом, выпущенным
 * своим CA, запросы сверяются с правилами из rules.json, подходящие отвечают локальным файлом
 * или инлайн-телом, остальные уходят на реальный сервер. Весь трафик пишется в лог.
 */
export class ProxyServer {
  private readonly matcher: RuleMatcher
  private readonly ca = new CertificateAuthority()
  private readonly outerServer: Server
  // сюда отдаются соединения из CONNECT-туннелей (расшифрованные, если внутри TLS)
  private readonly tunnelServer: Server
  private readonly targets = new WeakMap<Duplex, Target>()
  private readonly openSockets = new Set<Duplex>()

  constructor(
    rulesFilePath: string,
    private readonly onLog: (event: ProxyLogEvent) => void,
    private readonly onWarning: (message: string) => void
  ) {
    this.matcher = new RuleMatcher(rulesFilePath, onWarning)
    this.outerServer = createServer((req, res) => void this.handleRequest(req, res))
    this.tunnelServer = createServer((req, res) => void this.handleRequest(req, res))
    this.outerServer.on('connect', (req: IncomingMessage, socket: Socket, head: Buffer) => {
      this.handleConnect(req, socket, head)
    })
    for (const server of [this.outerServer, this.tunnelServer]) {
      server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
        this.handleUpgrade(req, socket, head)
      })
      server.on('clientError', (_err, socket) => socket.destroy())
    }
  }

  /** Начинает слушать порт; отклоняется, если порт занят */
  listen(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.outerServer.once('error', reject)
      this.outerServer.listen(port, host, () => {
        this.outerServer.off('error', reject)
        resolve()
      })
    })
  }

  /** Останавливает сервер и рвёт все открытые соединения */
  close(): void {
    this.outerServer.close()
    this.outerServer.closeAllConnections()
    this.tunnelServer.closeAllConnections()
    for (const socket of this.openSockets) socket.destroy()
    this.openSockets.clear()
  }

  private track(socket: Duplex): void {
    this.openSockets.add(socket)
    socket.on('close', () => this.openSockets.delete(socket))
  }

  private handleConnect(req: IncomingMessage, clientSocket: Socket, head: Buffer): void {
    const { host, port } = parseAuthority(req.url ?? '', 443)
    this.track(clientSocket)
    clientSocket.on('error', () => clientSocket.destroy())
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')

    const handleFirstChunk = (firstChunk: Buffer): void => {
      const stream = wrapSocket(clientSocket, firstChunk)
      if (firstChunk[0] !== TLS_HANDSHAKE_RECORD) {
        // не TLS (например ws:// через CONNECT) — внутри обычный HTTP
        this.targets.set(stream, { scheme: 'http', host, port })
        this.tunnelServer.emit('connection', stream)
        return
      }
      const tlsSocket = new TLSSocket(stream, {
        isServer: true,
        secureContext: this.ca.contextFor(host),
        SNICallback: (servername, callback) => {
          try {
            callback(null, this.ca.contextFor(servername || host))
          } catch (err) {
            callback(err instanceof Error ? err : new Error(String(err)))
          }
        },
        // h2 не перехватываем: браузер договаривается на HTTP/1.1
        ALPNProtocols: ['http/1.1']
      })
      tlsSocket.on('error', () => clientSocket.destroy())
      this.targets.set(tlsSocket, { scheme: 'https', host, port })
      this.tunnelServer.emit('connection', tlsSocket)
    }

    if (head.length > 0) {
      handleFirstChunk(head)
      return
    }
    clientSocket.once('data', (firstChunk: Buffer) => {
      clientSocket.pause()
      handleFirstChunk(firstChunk)
    })
  }

  /** Куда отправлять запрос; null — это не прокси-запрос (обращение к самому порту прокси) */
  private resolveTarget(req: IncomingMessage): { target: Target; path: string } | null {
    const connectTarget = this.targets.get(req.socket)
    if (connectTarget) return { target: connectTarget, path: req.url ?? '/' }

    const match = (req.url ?? '').match(/^(https?):\/\/([^/?#]+)(.*)$/i)
    if (!match) return null
    const scheme = match[1].toLowerCase() as Target['scheme']
    const { host, port } = parseAuthority(match[2], scheme === 'https' ? 443 : 80)
    return { target: { scheme, host, port }, path: match[3] || '/' }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const resolved = this.resolveTarget(req)
    if (!resolved) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('FileSwitcher: это прокси-сервер, укажите его в настройках прокси браузера или системы')
      return
    }
    const { target, path } = resolved
    const url = prettyUrl(target, req.headers.host, path)
    const requestHeaders = forwardableHeaders(req.rawHeaders)
    const requestBody = new BodyCapture()

    try {
      const match = this.matcher.match(url)
      if (match) {
        applyHeaderOverrides(requestHeaders, match.rule.requestHeaderOverrides)
        if (match.rule.delayMs) await sleep(match.rule.delayMs)
        const swapped = await this.swappedBody(match)
        if (swapped) {
          await drain(req, requestBody)
          this.respondWithSwap(req, res, { url, match, requestHeaders, requestBody, ...swapped })
          return
        }
      }
      await this.forward(req, res, { target, path, url, match, requestHeaders, requestBody })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(`FileSwitcher: ${message}`)
      } else {
        res.destroy()
      }
    }
  }

  /** Тело подмены из правила; null — правило меняет только заголовки/задержку/статус */
  private async swappedBody(match: RuleMatch): Promise<{ body: Buffer; contentType: string; file: string } | null> {
    const { rule, groups } = match
    // инлайн-тело в самом правиле приоритетнее файла; в лог как "файл подмены" писать нечего
    if (rule.responseBody) {
      return {
        body: Buffer.from(rule.responseBody, 'utf-8'),
        contentType: rule.contentType || 'application/json; charset=utf-8',
        file: ''
      }
    }
    if (!rule.localFilePath) return null

    try {
      // $1, $2, ... подставляются из групп regex-совпадения
      const path = groups ? resolveSubstitutedPath(rule.localFilePath, groups) : rule.localFilePath
      const body = await this.matcher.readReplacementFile(path)
      return { body, contentType: rule.contentType || guessContentType(path), file: path }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.onWarning(`правило ${rule.id}: localFilePath не применён — ${message}`)
      return null
    }
  }

  private respondWithSwap(
    req: IncomingMessage,
    res: ServerResponse,
    swap: {
      url: string
      match: RuleMatch
      requestHeaders: [string, string][]
      requestBody: BodyCapture
      body: Buffer
      contentType: string
      file: string
    }
  ): void {
    // Access-Control-Allow-Origin не выставляем автоматически: это сняло бы origin-границу для любой
    // страницы, знающей URL правила; при нужде его добавляют через responseHeaderOverrides
    const responseHeaders: [string, string][] = [
      ['Content-Type', swap.contentType],
      // без no-store браузер закэширует подмену и не будет видно, что правило вообще сработало
      ['Cache-Control', 'no-store'],
      ['Content-Length', String(swap.body.length)]
    ]
    applyHeaderOverrides(responseHeaders, swap.match.rule.responseHeaderOverrides)
    const statusCode = swap.match.rule.statusCodeOverride || 200
    res.writeHead(statusCode, responseHeaders.flat())
    res.end(swap.body)

    const responseBody = new BodyCapture()
    responseBody.add(swap.body)
    this.log({
      event: 'matched',
      url: swap.url,
      file: swap.file,
      method: req.method ?? 'GET',
      statusCode,
      requestHeaders: swap.requestHeaders,
      responseHeaders,
      requestBody: swap.requestBody,
      responseBody
    })
  }

  private forward(
    req: IncomingMessage,
    res: ServerResponse,
    context: {
      target: Target
      path: string
      url: string
      match: RuleMatch | null
      requestHeaders: [string, string][]
      requestBody: BodyCapture
    }
  ): Promise<void> {
    const { target, match, requestBody } = context
    const send = target.scheme === 'https' ? httpsRequest : httpRequest

    return new Promise((resolve, reject) => {
      const upstreamRequest = send({
        host: target.host,
        port: target.port,
        method: req.method,
        path: context.path,
        headers: context.requestHeaders.flat(),
        servername: target.host,
        ca: UPSTREAM_CA
      })
      upstreamRequest.on('error', reject)
      // клиент ушёл (закрыл вкладку, оборвал long polling) — не держим запрос к серверу
      res.on('close', () => {
        if (!res.writableFinished) upstreamRequest.destroy()
      })
      upstreamRequest.on('response', (upstreamResponse) => {
        const responseHeaders = forwardableHeaders(upstreamResponse.rawHeaders)
        applyHeaderOverrides(responseHeaders, match?.rule.responseHeaderOverrides)
        const statusCode = match?.rule.statusCodeOverride || upstreamResponse.statusCode || 502
        res.writeHead(statusCode, responseHeaders.flat())

        const responseBody = new BodyCapture()
        upstreamResponse.on('data', (chunk: Buffer) => responseBody.add(chunk))
        upstreamResponse.pipe(res)
        upstreamResponse.on('error', () => res.destroy())
        upstreamResponse.on('close', resolve)
        upstreamResponse.on('end', () => {
          this.log({
            // сработавшее правило без подмены тела всё равно считается matched
            event: match ? 'matched' : 'passed',
            url: context.url,
            file: '',
            method: req.method ?? 'GET',
            statusCode,
            requestHeaders: context.requestHeaders,
            responseHeaders,
            requestBody,
            responseBody
          })
        })
      })

      req.on('data', (chunk: Buffer) => requestBody.add(chunk))
      req.pipe(upstreamRequest)
    })
  }

  /** WebSocket и прочие Upgrade: пробрасываем рукопожатие и дальше гоняем байты как есть */
  private handleUpgrade(req: IncomingMessage, clientSocket: Socket, head: Buffer): void {
    const resolved = this.resolveTarget(req)
    if (!resolved) {
      clientSocket.destroy()
      return
    }
    const { target, path } = resolved
    this.track(clientSocket)
    const onConnected = (): void => {
      const lines = [`${req.method} ${path} HTTP/1.1`]
      for (let index = 0; index < req.rawHeaders.length; index += 2) {
        if (req.rawHeaders[index].toLowerCase() === 'proxy-connection') continue
        lines.push(`${req.rawHeaders[index]}: ${req.rawHeaders[index + 1]}`)
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (head.length > 0) upstream.write(head)
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    }
    const upstream =
      target.scheme === 'https'
        ? tlsConnect({ host: target.host, port: target.port, servername: target.host, ca: UPSTREAM_CA }, onConnected)
        : netConnect(target.port, target.host, onConnected)
    this.track(upstream)
    upstream.on('error', () => clientSocket.destroy())
    clientSocket.on('error', () => upstream.destroy())
    clientSocket.on('close', () => upstream.destroy())
  }

  private log(entry: {
    event: 'matched' | 'passed'
    url: string
    file: string
    method: string
    statusCode: number
    requestHeaders: [string, string][]
    responseHeaders: [string, string][]
    requestBody: BodyCapture
    responseBody: BodyCapture
  }): void {
    const requestBody = entry.requestBody.decode()
    const responseBody = entry.responseBody.decode()
    this.onLog({
      event: entry.event,
      url: entry.url,
      file: entry.file,
      method: entry.method,
      statusCode: entry.statusCode,
      requestHeaders: headersForLog(entry.requestHeaders),
      responseHeaders: headersForLog(entry.responseHeaders),
      responseSize: entry.responseBody.size,
      // ts служит идентификатором записи в логе — нужна точность меньше миллисекунды
      ts: (performance.timeOrigin + performance.now()) / 1000,
      requestBody: requestBody.text,
      requestBodyIsBinary: requestBody.isBinary,
      requestBodySize: entry.requestBody.size,
      responseBody: responseBody.text,
      responseBodyIsBinary: responseBody.isBinary
    })
  }
}
