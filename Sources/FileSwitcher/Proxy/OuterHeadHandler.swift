import Foundation
import NIOCore

/// Первый уровень соединения: разбирает CONNECT и absolute-form, решает, будет ли внутри TLS
final class OuterHeadHandler: ChannelInboundHandler, @unchecked Sendable {
    typealias InboundIn = ByteBuffer
    typealias OutboundOut = ByteBuffer

    /// Что сейчас читаем с сокета
    private enum Phase {
        case awaitingHead
        case awaitingFirstByte
        case handedOff
    }

    private let setup: ConnectionSetupContext
    private var buffer = ByteBuffer()
    private var phase: Phase = .awaitingHead
    private var connectTarget: ProxyTarget?

    init(context: ConnectionSetupContext) {
        setup = context
    }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        if phase == .handedOff {
            context.fireChannelRead(data)
            return
        }
        var incoming = unwrapInboundIn(data)
        buffer.writeBuffer(&incoming)

        switch phase {
        case .awaitingHead:
            guard let parsed = parseRawRequestHead(buffer) else {
                if buffer.readableBytes > 64 * 1024 {
                    context.close(promise: nil)
                }
                return
            }
            if parsed.head.isConnect {
                startTunnel(context: context, head: parsed.head, leftover: parsed.leftover)
            } else {
                startPlainHTTP(context: context, head: parsed.head)
            }
        case .awaitingFirstByte:
            guard buffer.readableBytes > 0 else {
                return
            }
            startTunnelHandshake(context: context)
        case .handedOff:
            break
        }
    }

    /// CONNECT: отвечаем 200 и ждём первый байт, чтобы понять TLS это или обычный HTTP
    private func startTunnel(context: ChannelHandlerContext, head: RawRequestHead, leftover: ByteBuffer) {
        let parsedAuthority = parseAuthority(head.uri, defaultPort: 443)
        connectTarget = ProxyTarget(scheme: .https, host: parsedAuthority.host, port: parsedAuthority.port)
        var response = context.channel.allocator.buffer(capacity: 39)
        response.writeString("HTTP/1.1 200 Connection Established\r\n\r\n")
        context.writeAndFlush(wrapOutboundOut(response), promise: nil)
        phase = .awaitingFirstByte
        buffer = leftover
        if buffer.readableBytes > 0 {
            startTunnelHandshake(context: context)
        }
    }

    /// Абсолютная форма URL: клиент шлёт обычные HTTP-запросы прямо на порт прокси
    private func startPlainHTTP(context: ChannelHandlerContext, head: RawRequestHead) {
        let absolute = parseAbsoluteForm(head.uri)
        phase = .handedOff
        var payload = buffer
        buffer = ByteBuffer()
        if head.isUpgrade {
            guard let absolute else {
                context.close(promise: nil)
                return
            }
            let headBytes = serializeRawRequestHead(head, path: absolute.path)
            RawTunnel.start(context: context, setup: setup, target: absolute.target, headBytes: headBytes, leftover: payload)
            return
        }
        let forwarded = payload
        ProxyPipeline.installHTTP(context: context, setup: setup, tunnelTarget: nil, payload: forwarded)
    }

    /// Решает, поднимать ли TLS внутри туннеля, и передаёт дальше уже расшифрованные байты
    private func startTunnelHandshake(context: ChannelHandlerContext) {
        phase = .handedOff
        let payload = buffer
        buffer = ByteBuffer()
        let firstByte = payload.getInteger(at: payload.readerIndex, as: UInt8.self) ?? 0
        let target = connectTarget
        if firstByte == 0x16 {
            ProxyPipeline.installTLS(
                context: context,
                setup: setup,
                host: target?.host ?? "localhost",
                target: target,
                payload: payload
            )
        } else {
            ProxyPipeline.installPlainTunnel(context: context, setup: setup, target: target, payload: payload)
        }
    }
}
