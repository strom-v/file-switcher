import Foundation
import NIOCore
import NIOPosix
import NIOHTTP1
import NIOSSL
import os

/// Встроенный HTTP(S)-прокси с перехватом TLS: CONNECT-туннели терминируются сертификатом своего CA,
/// запросы сверяются с правилами, подменённые отвечают локально, остальные уходят на реальный сервер
final class ProxyServer: @unchecked Sendable {
    private let authority: CertificateAuthority
    private let group: any EventLoopGroup
    private let ruleEngine: (any RuleEngine)?
    private let onLog: @Sendable (ProxyLogEvent) -> Void
    private let onWarning: @Sendable (String) -> Void
    private let serverChannel = OSAllocatedUnfairLock<Channel?>(initialState: nil)

    init(
        authority: CertificateAuthority,
        group: any EventLoopGroup,
        ruleEngine: (any RuleEngine)?,
        onLog: @escaping @Sendable (ProxyLogEvent) -> Void,
        onWarning: @escaping @Sendable (String) -> Void
    ) {
        self.authority = authority
        self.group = group
        self.ruleEngine = ruleEngine
        self.onLog = onLog
        self.onWarning = onWarning
    }

    /// Начинает слушать порт; бросает ошибку, если порт занят
    func start(host: String, port: Int) async throws {
        let setup = ConnectionSetupContext(
            authority: authority,
            group: group,
            ruleEngine: ruleEngine,
            onLog: onLog,
            onWarning: onWarning
        )
        let bootstrap = ServerBootstrap(group: group)
            .serverChannelOption(ChannelOptions.backlog, value: 256)
            .serverChannelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
            .childChannelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
            .childChannelInitializer { channel in
                channel.pipeline.addHandler(OuterHeadHandler(context: setup))
            }
        let channel = try await bootstrap.bind(host: host, port: port).get()
        serverChannel.withLock { $0 = channel }
    }

    /// Останавливает сервер и рвёт все открытые соединения
    func stop() {
        let channel = serverChannel.withLock { current -> Channel? in
            let value = current
            current = nil
            return value
        }
        try? channel?.close().wait()
    }
}

/// Общие зависимости обработчиков соединений
struct ConnectionSetupContext: Sendable {
    var authority: CertificateAuthority
    var group: any EventLoopGroup
    var ruleEngine: (any RuleEngine)?
    var onLog: @Sendable (ProxyLogEvent) -> Void
    var onWarning: @Sendable (String) -> Void
}
