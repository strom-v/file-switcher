import Foundation
import NIOCore
import NIOHTTP1
import NIOSSL

/// Собирает пайплайн соединения после того, как заголовок разобран вручную
enum ProxyPipeline {
    /// Ставит HTTP-кодек и обработчик запросов ниже текущего обработчика и отдаёт им прочитанное
    static func installHTTP(
        context: ChannelHandlerContext,
        setup: ConnectionSetupContext,
        tunnelTarget: ProxyTarget?,
        payload: ByteBuffer
    ) {
        // порядок важен: encoder ближе к сокету, decoder за ним - так outbound-части
        // проходят через decoder (он наблюдает write) и попадают в encoder
        let encoder = HTTPResponseEncoder()
        let decoder = ByteToMessageHandler(HTTPRequestDecoder(leftOverBytesStrategy: .forwardBytes))
        let handler = ProxyConnectionHandler(setup: setup, tunnelTarget: tunnelTarget)
        do {
            try context.pipeline.syncOperations.addHandlers([encoder, decoder, handler])
        } catch {
            context.close(promise: nil)
            return
        }
        if payload.readableBytes > 0 {
            context.fireChannelRead(NIOAny(payload))
        }
    }

    /// Ставит в туннель TLS-сервер с выпущенным сертификатом и обработчик следующего уровня
    static func installTLS(
        context: ChannelHandlerContext,
        setup: ConnectionSetupContext,
        host: String,
        target: ProxyTarget?,
        payload: ByteBuffer
    ) {
        do {
            let tls = try NIOSSLServerHandler(context: setup.authority.context(forHost: host))
            let inner = TunnelHeadHandler(setup: setup, target: target)
            try context.pipeline.syncOperations.addHandlers([tls, inner])
        } catch {
            context.close(promise: nil)
            return
        }
        if payload.readableBytes > 0 {
            context.fireChannelRead(NIOAny(payload))
        }
    }

    /// Ставит в туннель обработчик следующего уровня без TLS
    static func installPlainTunnel(
        context: ChannelHandlerContext,
        setup: ConnectionSetupContext,
        target: ProxyTarget?,
        payload: ByteBuffer
    ) {
        do {
            try context.pipeline.syncOperations.addHandler(TunnelHeadHandler(setup: setup, target: target))
        } catch {
            context.close(promise: nil)
            return
        }
        if payload.readableBytes > 0 {
            context.fireChannelRead(NIOAny(payload))
        }
    }
}
