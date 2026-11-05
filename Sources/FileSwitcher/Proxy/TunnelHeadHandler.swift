import Foundation
import NIOCore

/// Второй уровень: внутри CONNECT-туннеля (уже после TLS, если он там был) разбирает первый заголовок
final class TunnelHeadHandler: ChannelInboundHandler, @unchecked Sendable {
    typealias InboundIn = ByteBuffer

    private let setup: ConnectionSetupContext
    private let target: ProxyTarget?
    private var buffer = ByteBuffer()
    private var handedOff = false
    private var relay: RawTunnelRelay?

    init(setup: ConnectionSetupContext, target: ProxyTarget?) {
        self.setup = setup
        self.target = target
    }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        if let relay {
            relay.clientRead(unwrapInboundIn(data))
            return
        }
        if handedOff {
            context.fireChannelRead(data)
            return
        }
        var incoming = unwrapInboundIn(data)
        buffer.writeBuffer(&incoming)
        guard let parsed = parseRawRequestHead(buffer) else {
            if buffer.readableBytes > 64 * 1024 {
                context.close(promise: nil)
            }
            return
        }
        handedOff = true
        let payload = buffer
        buffer = ByteBuffer()

        if parsed.head.isUpgrade, let target {
            relay = RawTunnel.start(
                context: context,
                setup: setup,
                target: target,
                headBytes: serializeRawRequestHead(parsed.head, path: parsed.head.uri),
                leftover: payload
            )
            return
        }
        ProxyPipeline.installHTTP(context: context, setup: setup, tunnelTarget: target, payload: payload)
    }

    func channelInactive(context: ChannelHandlerContext) {
        relay?.clientClosed()
        context.fireChannelInactive()
    }

    func errorCaught(context: ChannelHandlerContext, error: Error) {
        relay?.clientClosed()
        context.close(promise: nil)
    }
}
