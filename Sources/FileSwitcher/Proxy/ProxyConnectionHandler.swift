import Foundation
import NIOCore
import NIOPosix
import NIOHTTP1
import NIOSSL

/// Обрабатывает HTTP/1.1 внутри одного клиентского соединения: сверяет с правилами, отвечает
/// подменой, остальное пересылает на реальный сервер. `@unchecked Sendable`: состояние меняется
/// только на event loop клиентского канала.
final class ProxyConnectionHandler: ChannelInboundHandler, @unchecked Sendable {
    typealias InboundIn = HTTPServerRequestPart
    typealias OutboundOut = HTTPServerResponsePart

    /// Что происходит с текущим запросом
    private enum Stage {
        case idle
        case awaitingUpstream
        case streaming
        case swapping
    }

    private let setup: ConnectionSetupContext
    private let tunnelTarget: ProxyTarget?
    private var clientChannel: Channel?

    private var stage: Stage = .idle
    private var head: HTTPRequestHead?
    private var target: ProxyTarget?
    private var path = "/"
    private var url = ""
    private var requestPairs: [(String, String)] = []
    private var requestBody = BodyCapture()
    private var match: RuleMatch?
    private var swapped: ReplacementBody?
    private var clientWantsClose = false

    private var upstream: Channel?
    private var queuedParts: [HTTPServerRequestPart] = []

    private var responseBody = BodyCapture()
    private var responsePairs: [(String, String)] = []
    private var responseStatusCode = 0

    init(setup: ConnectionSetupContext, tunnelTarget: ProxyTarget?) {
        self.setup = setup
        self.tunnelTarget = tunnelTarget
    }

    func handlerAdded(context: ChannelHandlerContext) {
        clientChannel = context.channel
    }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        let part = unwrapInboundIn(data)
        switch part {
        case let .head(requestHead):
            onHead(head: requestHead)
        case let .body(buffer):
            requestBody.add(buffer)
            switch stage {
            case .awaitingUpstream:
                queuedParts.append(part)
            case .streaming:
                upstream?.write(HTTPClientRequestPart.body(.byteBuffer(buffer)), promise: nil)
            case .idle, .swapping:
                break
            }
        case .end:
            switch stage {
            case .awaitingUpstream:
                queuedParts.append(part)
            case .streaming:
                upstream?.writeAndFlush(HTTPClientRequestPart.end(nil), promise: nil)
            case .swapping:
                respondWithSwap()
            case .idle:
                break
            }
        }
    }

    func channelInactive(context: ChannelHandlerContext) {
        upstream?.close(promise: nil)
        upstream = nil
        context.fireChannelInactive()
    }

    func errorCaught(context: ChannelHandlerContext, error: Error) {
        upstream?.close(promise: nil)
        upstream = nil
        context.close(promise: nil)
    }

    /// Новый запрос: считаем адрес, сверяем с правилами и запускаем обработку
    private func onHead(head requestHead: HTTPRequestHead) {
        head = requestHead
        requestBody = BodyCapture()
        responseBody = BodyCapture()
        responsePairs = []
        queuedParts = []
        match = nil
        swapped = nil
        clientWantsClose = !requestHead.isKeepAlive

        let resolvedTarget: ProxyTarget
        if let tunnelTarget {
            resolvedTarget = tunnelTarget
            path = requestHead.uri.isEmpty ? "/" : requestHead.uri
        } else if let absolute = parseAbsoluteForm(requestHead.uri) {
            resolvedTarget = absolute.target
            path = absolute.path
        } else {
            respondText(status: .badRequest, text: "FileSwitcher: это прокси-сервер, укажите его в настройках прокси браузера или системы")
            return
        }
        target = resolvedTarget
        url = prettyUrl(target: resolvedTarget, hostHeader: requestHead.headers.first(name: "host"), path: path)
        requestPairs = forwardableHeaders(requestHead.headers)
        match = setup.ruleEngine?.match(url)
        if let match {
            applyHeaderOverrides(&requestPairs, match.rule.requestHeaderOverrides)
        }

        stage = .awaitingUpstream
        let delay = match?.rule.delayMs ?? 0
        guard delay > 0 else {
            startRequest()
            return
        }
        // эмуляция медленной сети: ответ уходит позже, тело запроса копится в очереди
        clientChannel?.eventLoop.scheduleTask(in: .milliseconds(Int64(delay))) { [self] in
            clientChannel?.eventLoop.execute { [self] in
                startRequest()
            }
        }
    }

    /// Решает, отвечать подменой или открывать соединение с настоящим сервером
    private func startRequest() {
        guard stage == .awaitingUpstream else {
            return
        }
        if let match, let body = try? setup.ruleEngine?.replacementBody(for: match) {
            swapped = body
            stage = .swapping
            return
        }
        openUpstream()
    }

    /// Открывает соединение с настоящим сервером
    private func openUpstream() {
        guard let target, let clientChannel else {
            return
        }
        let group = setup.group
        let bootstrap = ClientBootstrap(group: group)
            .channelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
            .channelInitializer { channel in
                var handlers: [any ChannelHandler] = []
                if target.scheme == .https {
                    do {
                        let configuration = TLSConfiguration.makeClientConfiguration()
                        let tls = try NIOSSLClientHandler(
                            context: NIOSSLContext(configuration: configuration),
                            serverHostname: target.host
                        )
                        handlers.append(tls)
                    } catch {
                        return channel.eventLoop.makeFailedFuture(error)
                    }
                }
                handlers.append(HTTPRequestEncoder())
                handlers.append(ByteToMessageHandler(HTTPResponseDecoder(leftOverBytesStrategy: .forwardBytes)))
                handlers.append(UpstreamResponseHandler(client: clientChannel, owner: self))
                let pipeline = channel.pipeline
                for handler in handlers {
                    _ = pipeline.addHandler(handler)
                }
                return pipeline.eventLoop.makeSucceededVoidFuture()
            }
        bootstrap.connect(host: target.host, port: target.port).whenComplete { [self] result in
            clientChannel.eventLoop.execute { [self] in
                switch result {
                case let .success(channel):
                    upstream = channel
                    sendRequestHead()
                    flushQueuedParts()
                    stage = .streaming
                case .failure:
                    respondText(
                        status: .badGateway,
                        text: "FileSwitcher: не удалось подключиться к \(target.host):\(target.port)"
                    )
                }
            }
        }
    }

    /// Отправляет апстриму заголовок текущего запроса
    private func sendRequestHead() {
        guard let head, let upstream else {
            return
        }
        let upstreamHead = HTTPRequestHead(version: .http1_1, method: head.method, uri: path, headers: HTTPHeaders(requestPairs))
        upstream.write(HTTPClientRequestPart.head(upstreamHead), promise: nil)
    }

    /// Отдаёт апстриму части, пришедшие до готовности соединения
    private func flushQueuedParts() {
        guard let upstream else {
            return
        }
        for part in queuedParts {
            switch part {
            case .head:
                break
            case let .body(buffer):
                upstream.write(HTTPClientRequestPart.body(.byteBuffer(buffer)), promise: nil)
            case .end:
                upstream.writeAndFlush(HTTPClientRequestPart.end(nil), promise: nil)
            }
        }
        queuedParts = []
    }

    /// Ответ подменой: тело правила, свой content-type и запрет кэширования
    private func respondWithSwap() {
        guard let swapped, let clientChannel else {
            return
        }
        var pairs: [(String, String)] = [
            ("Content-Type", swapped.contentType),
            // без no-store браузер закэширует подмену и не будет видно, что правило сработало
            ("Cache-Control", "no-store"),
            ("Content-Length", String(swapped.body.count))
        ]
        applyHeaderOverrides(&pairs, match?.rule.responseHeaderOverrides)
        let statusCode = match?.rule.statusCodeOverride ?? 200
        let responseHead = HTTPResponseHead(
            version: .http1_1,
            status: HTTPResponseStatus(statusCode: statusCode),
            headers: HTTPHeaders(pairs)
        )
        _ = clientChannel.write(HTTPServerResponsePart.head(responseHead))
        var buffer = clientChannel.allocator.buffer(capacity: swapped.body.count)
        buffer.writeBytes(swapped.body)
        _ = clientChannel.write(HTTPServerResponsePart.body(.byteBuffer(buffer)))
        clientChannel.writeAndFlush(HTTPServerResponsePart.end(nil)).whenFailure { _ in }

        responseBody = BodyCapture()
        responseBody.add(bytes: swapped.body)
        log(event: .matched, file: swapped.file, statusCode: statusCode, responsePairs: pairs)
        finishRequest()
    }

    /// Короткий текстовый ответ прокси: не прокси-запрос или недоступный сервер
    private func respondText(status: HTTPResponseStatus, text: String) {
        guard let clientChannel else {
            return
        }
        let body = Data(text.utf8)
        var headers = HTTPHeaders()
        headers.add(name: "Content-Type", value: "text/plain; charset=utf-8")
        headers.add(name: "Content-Length", value: String(body.count))
        headers.add(name: "Connection", value: "close")
        _ = clientChannel.write(HTTPServerResponsePart.head(HTTPResponseHead(version: .http1_1, status: status, headers: headers)))
        var buffer = clientChannel.allocator.buffer(capacity: body.count)
        buffer.writeBytes(body)
        _ = clientChannel.write(HTTPServerResponsePart.body(.byteBuffer(buffer)))
        let written = clientChannel.writeAndFlush(HTTPServerResponsePart.end(nil))
        written.whenComplete { _ in
            clientChannel.close(promise: nil)
        }
        stage = .idle
    }

    /// Часть ответа настоящего сервера — вызывается на event loop клиентского канала
    func onUpstreamPart(_ part: HTTPClientResponsePart) {
        guard let clientChannel else {
            return
        }
        switch part {
        case let .head(responseHead):
            onUpstreamHead(head: responseHead)
        case let .body(buffer):
            responseBody.add(buffer)
            _ = clientChannel.write(HTTPServerResponsePart.body(.byteBuffer(buffer)))
        case .end:
            clientChannel.writeAndFlush(HTTPServerResponsePart.end(nil)).whenFailure { _ in }
            log(
                event: match != nil ? .matched : .passed,
                file: "",
                statusCode: responseStatusCode,
                responsePairs: responsePairs
            )
            upstream?.close(promise: nil)
            upstream = nil
            finishRequest()
        }
    }

    /// Заголовок ответа сервера: фильтрация hop-by-hop и переопределения из правила
    private func onUpstreamHead(head responseHead: HTTPResponseHead) {
        var pairs = forwardableResponseHeaders(responseHead.headers)
        applyHeaderOverrides(&pairs, match?.rule.responseHeaderOverrides)
        responsePairs = pairs
        let statusCode = match?.rule.statusCodeOverride ?? Int(responseHead.status.code)
        responseStatusCode = statusCode
        let clientHead = HTTPResponseHead(
            version: .http1_1,
            status: HTTPResponseStatus(statusCode: statusCode),
            headers: HTTPHeaders(pairs)
        )
        _ = clientChannel?.write(HTTPServerResponsePart.head(clientHead))
    }

    /// Запрос завершён: соединение либо ждёт следующий, либо закрывается
    private func finishRequest() {
        stage = .idle
        queuedParts = []
        if clientWantsClose {
            clientChannel?.close(promise: nil)
        }
    }

    /// Пишет событие трафика в журнал
    private func log(
        event: ProxyLogEventType,
        file: String,
        statusCode: Int,
        responsePairs: [(String, String)]
    ) {
        guard let head else {
            return
        }
        let requestBodyText = requestBody.decode()
        let responseBodyText = responseBody.decode()
        setup.onLog(
            ProxyLogEvent(
                event: event,
                url: url,
                file: file,
                method: head.method.rawValue,
                statusCode: statusCode,
                requestHeaders: headersForLog(requestPairs),
                responseHeaders: headersForLog(responsePairs),
                responseSize: responseBody.size,
                ts: Date().timeIntervalSince1970,
                requestBody: requestBodyText.text,
                requestBodyIsBinary: requestBodyText.isBinary,
                requestBodySize: requestBody.size,
                responseBody: responseBodyText.text,
                responseBodyIsBinary: responseBodyText.isBinary
            )
        )
    }
}

/// Отдаёт части ответа настоящего сервера в обработчик клиентского соединения
final class UpstreamResponseHandler: ChannelInboundHandler, @unchecked Sendable {
    typealias InboundIn = HTTPClientResponsePart

    private let client: Channel
    private let owner: ProxyConnectionHandler

    init(client: Channel, owner: ProxyConnectionHandler) {
        self.client = client
        self.owner = owner
    }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        let part = unwrapInboundIn(data)
        // обработчик живёт на loop апстрима, состояние запроса - на loop клиента
        client.eventLoop.execute { [self] in
            owner.onUpstreamPart(part)
        }
    }

    func channelInactive(context: ChannelHandlerContext) {
        client.close(promise: nil)
    }

    func errorCaught(context: ChannelHandlerContext, error: Error) {
        client.close(promise: nil)
    }
}
