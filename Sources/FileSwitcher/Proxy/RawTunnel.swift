import Foundation
import NIOCore
import NIOPosix
import NIOSSL

/// Пробрасывает соединение байтами: рукопожатие WebSocket и дальше всё как есть
enum RawTunnel {
    /// Открывает соединение с апстримом и отдаёт ему уже прочитанный заголовок
    static func start(
        context: ChannelHandlerContext,
        setup: ConnectionSetupContext,
        target: ProxyTarget,
        headBytes: String,
        leftover: ByteBuffer
    ) -> RawTunnelRelay {
        let relay = RawTunnelRelay(client: context.channel)
        let bootstrap = ClientBootstrap(group: setup.group)
            .channelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
            .channelInitializer { channel in
                guard target.scheme == .https else {
                    return channel.pipeline.addHandler(RawUpstreamHandler(relay: relay))
                }
                do {
                    let tls = try NIOSSLClientHandler(
                        context: setup.authority.clientTLSContext(),
                        serverHostname: target.host
                    )
                    return channel.pipeline.addHandlers([tls, RawUpstreamHandler(relay: relay)])
                } catch {
                    return channel.eventLoop.makeFailedFuture(error)
                }
            }
        let client = context.channel
        bootstrap.connect(host: target.host, port: target.port).whenComplete { result in
            client.eventLoop.execute {
                switch result {
                case let .success(channel):
                    relay.attach(upstream: channel, headBytes: headBytes, leftover: leftover)
                case .failure:
                    client.close(promise: nil)
                }
            }
        }
        return relay
    }
}

/// Общее состояние одного «глухого» проброса: байты клиента идут в апстрим, ответ — обратно
final class RawTunnelRelay: @unchecked Sendable {
    private let client: Channel
    private var upstream: Channel?
    private var pending: [ByteBuffer] = []
    private var closed = false
    private let directAllocator: ByteBufferAllocator

    init(client: Channel) {
        self.client = client
        directAllocator = client.allocator
    }

    /// Соединение с апстримом готово: отдаём ему заголовок и всё, что успело накопиться
    func attach(upstream channel: Channel, headBytes: String, leftover: ByteBuffer) {
        guard !closed else {
            channel.close(promise: nil)
            return
        }
        upstream = channel
        var buffer = channel.allocator.buffer(capacity: headBytes.utf8.count + leftover.readableBytes)
        buffer.writeString(headBytes)
        var leftoverCopy = leftover
        buffer.writeBuffer(&leftoverCopy)
        channel.writeAndFlush(buffer, promise: nil)
        for chunk in pending {
            channel.writeAndFlush(chunk, promise: nil)
        }
        pending.removeAll()
    }

    /// Байты от клиента
    func clientRead(_ buffer: ByteBuffer) {
        guard !closed else {
            return
        }
        if let upstream {
            upstream.writeAndFlush(buffer, promise: nil)
        } else {
            pending.append(buffer)
        }
    }

    /// Байты от апстрима
    func upstreamRead(_ buffer: ByteBuffer) {
        guard !closed else {
            return
        }
        client.writeAndFlush(buffer, promise: nil)
    }

    /// Клиент закрыл соединение
    func clientClosed() {
        guard !closed else {
            return
        }
        closed = true
        upstream?.close(promise: nil)
    }

    /// Апстрим закрыл соединение
    func upstreamClosed() {
        guard !closed else {
            return
        }
        closed = true
        client.close(promise: nil)
    }
}

/// Отдаёт байты апстрима в проброс
final class RawUpstreamHandler: ChannelInboundHandler, @unchecked Sendable {
    typealias InboundIn = ByteBuffer

    private let relay: RawTunnelRelay

    init(relay: RawTunnelRelay) {
        self.relay = relay
    }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        relay.upstreamRead(unwrapInboundIn(data))
    }

    func channelInactive(context: ChannelHandlerContext) {
        relay.upstreamClosed()
    }

    func errorCaught(context: ChannelHandlerContext, error: Error) {
        relay.upstreamClosed()
    }
}
