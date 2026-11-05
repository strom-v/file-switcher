import Foundation
import NIOCore
import NIOPosix
import NIOSSL

/// Спайк этапа 1: туннель без разбора HTTP - проверяет, что динамический TLS-сертификат
/// на лету поднимается поверх CONNECT и трафик доходит до апстрима и обратно.
enum ProxySpike {
    /// Поднимает прокси на 127.0.0.1 и работает до сигнала
    static func run(port: Int) throws {
        let authority = try CertificateAuthority()
        let group = MultiThreadedEventLoopGroup(numberOfThreads: System.coreCount)
        let bootstrap = ServerBootstrap(group: group)
            .serverChannelOption(ChannelOptions.backlog, value: 256)
            .serverChannelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
            .childChannelInitializer { channel in
                channel.pipeline.addHandler(TunnelHandler(authority: authority, group: group))
            }
        let channel = try bootstrap.bind(host: "127.0.0.1", port: port).wait()
        print("прокси слушает 127.0.0.1:\(port)")
        try channel.closeFuture.wait()
        try group.syncShutdownGracefully()
    }
}

/// Читает первый запрос, отвечает на CONNECT и поднимает TLS с выпущенным сертификатом.
/// `@unchecked Sendable`: состояние меняется только на event loop своего канала.
private final class TunnelHandler: ChannelInboundHandler, @unchecked Sendable {
    typealias InboundIn = ByteBuffer
    typealias OutboundOut = ByteBuffer

    private let authority: CertificateAuthority
    private let group: any EventLoopGroup
    private var pending = ByteBuffer()
    private var handedOff = false

    init(authority: CertificateAuthority, group: any EventLoopGroup) {
        self.authority = authority
        self.group = group
    }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        guard !handedOff else {
            context.fireChannelRead(data)
            return
        }
        var incoming = unwrapInboundIn(data)
        pending.writeBuffer(&incoming)
        guard let head = takeHead() else {
            if pending.readableBytes > 8192 {
                context.close(promise: nil)
            }
            return
        }
        guard let request = RequestHead(String(decoding: head.readableBytesView, as: UTF8.self)) else {
            context.close(promise: nil)
            return
        }
        handOff(context: context, request: request, head: head, leftover: pending)
    }

    private func handOff(context: ChannelHandlerContext, request: RequestHead, head: ByteBuffer, leftover: ByteBuffer) {
        handedOff = true
        pending = ByteBuffer()
        do {
            if request.isConnect {
                // клиент ждёт 200 и только потом начинает TLS-рукопожатие
                var response = context.channel.allocator.buffer(capacity: 39)
                response.writeString("HTTP/1.1 200 Connection Established\r\n\r\n")
                context.writeAndFlush(wrapOutboundOut(response), promise: nil)
                let tls = try NIOSSLServerHandler(context: authority.context(forHost: request.host))
                try context.pipeline.syncOperations.addHandler(tls)
            }
            try context.pipeline.syncOperations.addHandler(
                RelayHandler(host: request.host, port: request.port, useTLS: request.isConnect, group: group)
            )
        } catch {
            context.close(promise: nil)
            return
        }
        // без CONNECT запрос уходит апстриму целиком: заголовки плюс то, что пришло следом
        if !request.isConnect {
            context.pipeline.fireChannelRead(head)
        }
        if leftover.readableBytes > 0 {
            context.pipeline.fireChannelRead(leftover)
        }
    }

    /// Отрезает от накопленного буфера заголовки первого запроса вместе с пустой строкой
    private func takeHead() -> ByteBuffer? {
        let bytes = Array(pending.readableBytesView)
        guard let headerEnd = Self.findHeaderEnd(bytes) else { return nil }
        return pending.readSlice(length: headerEnd + 4)
    }

    /// Первый байт CRLFCRLF: им заканчиваются заголовки запроса
    private static func findHeaderEnd(_ bytes: [UInt8]) -> Int? {
        guard bytes.count > 3 else { return nil }
        for index in 0..<(bytes.count - 3) {
            if bytes[index] == 0x0d, bytes[index + 1] == 0x0a, bytes[index + 2] == 0x0d, bytes[index + 3] == 0x0a {
                return index
            }
        }
        return nil
    }
}

/// Первая строка запроса: метод и адрес назначения
private struct RequestHead {
    let isConnect: Bool
    let host: String
    let port: Int

    /// Разбирает строку запроса
    init?(_ head: String) {
        guard let firstLine = head.components(separatedBy: "\r\n").first else { return nil }
        let parts = firstLine.split(separator: " ")
        guard parts.count >= 2 else { return nil }
        let method = String(parts[0])
        let target = String(parts[1])
        if method == "CONNECT" {
            guard let separator = target.lastIndex(of: ":") else { return nil }
            let host = String(target[target.startIndex..<separator])
            guard !host.isEmpty, let port = Int(target[target.index(after: separator)...]) else { return nil }
            isConnect = true
            self.host = host
            self.port = port
            return
        }
        // без CONNECT приходит absolute-form: http://host:port/path
        guard let url = URL(string: target), let host = url.host else { return nil }
        isConnect = false
        self.host = host
        port = url.port ?? 80
    }
}

/// Перекидывает байты клиент → апстрим и обратно, пока одна из сторон не закроет канал.
/// `@unchecked Sendable`: состояние трогается только на event loop канала клиента.
private final class RelayHandler: ChannelInboundHandler, @unchecked Sendable {
    typealias InboundIn = ByteBuffer

    private let host: String
    private let port: Int
    private let useTLS: Bool
    private let group: any EventLoopGroup
    private var upstream: Channel?
    private var pending: [ByteBuffer] = []

    init(host: String, port: Int, useTLS: Bool, group: any EventLoopGroup) {
        self.host = host
        self.port = port
        self.useTLS = useTLS
        self.group = group
    }

    func handlerAdded(context: ChannelHandlerContext) {
        connect(context: context)
    }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        // shortcut: без контроля обратного давления и с потолком буфера - спайк, заменяется разбором HTTP
        let buffer = unwrapInboundIn(data)
        if let upstream {
            upstream.writeAndFlush(buffer, promise: nil)
        } else if pending.count < 16 {
            pending.append(buffer)
        }
    }

    func channelInactive(context: ChannelHandlerContext) {
        upstream?.close(promise: nil)
    }

    func errorCaught(context: ChannelHandlerContext, error: Error) {
        upstream?.close(promise: nil)
        context.close(promise: nil)
    }

    /// Открывает соединение с апстримом и отдаёт ему накопленное
    private func connect(context: ChannelHandlerContext) {
        let client = context.channel
        let group = self.group
        let host = self.host
        let port = self.port
        let useTLS = self.useTLS
        let bootstrap = ClientBootstrap(group: group)
            .channelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
            .channelInitializer { channel in
                guard useTLS else {
                    return channel.pipeline.addHandler(UpstreamRelayHandler(client: client))
                }
                do {
                    // доверие к апстриму - системный набор корней: корпоративный CA стендов проходит
                    let configuration = TLSConfiguration.makeClientConfiguration()
                    let tls = try NIOSSLClientHandler(
                        context: NIOSSLContext(configuration: configuration),
                        serverHostname: host
                    )
                    // NIOSSLHandler не помечен Sendable - единственное предупреждение сборки, из NIOSSL
                    return channel.pipeline.addHandlers([tls, UpstreamRelayHandler(client: client)])
                } catch {
                    return channel.eventLoop.makeFailedFuture(error)
                }
            }
        bootstrap.connect(host: host, port: port).whenComplete { result in
            client.eventLoop.execute { [self] in
                switch result {
                case let .success(channel):
                    upstream = channel
                    for buffer in pending {
                        channel.writeAndFlush(buffer, promise: nil)
                    }
                    pending.removeAll()
                case .failure:
                    client.close(promise: nil)
                }
            }
        }
    }
}

/// Отдаёт ответ апстрима клиенту.
private final class UpstreamRelayHandler: ChannelInboundHandler, @unchecked Sendable {
    typealias InboundIn = ByteBuffer

    private let client: Channel

    init(client: Channel) {
        self.client = client
    }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        client.writeAndFlush(unwrapInboundIn(data), promise: nil)
    }

    func channelInactive(context: ChannelHandlerContext) {
        client.close(mode: .output, promise: nil)
    }

    func errorCaught(context: ChannelHandlerContext, error: Error) {
        client.close(promise: nil)
        context.close(promise: nil)
    }
}
