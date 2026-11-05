import Foundation
import NIOCore
import NIOPosix

/// Прокси без интерфейса: ручной прогон движка на порту (`--proxy <порт>`)
enum DebugProxy {
    /// Поднимает прокси без правил и пишет события в файл сессии
    static func run(port: Int) async throws {
        let authority = try CertificateAuthority()
        let group = MultiThreadedEventLoopGroup(numberOfThreads: System.coreCount)
        let store = LogStore()
        let server = ProxyServer(
            authority: authority,
            group: group,
            ruleEngine: nil,
            onLog: { event in
                _ = store.appendBatch([event])
            },
            onWarning: { message in
                SelfTest.writeError(message)
            }
        )
        try await server.start(host: "127.0.0.1", port: port)
        print("прокси слушает 127.0.0.1:\(port), журнал: \(store.filePath)")
        // процесс живёт до сигнала: сервер остаётся в цикле событий
        try await Task.sleep(for: .seconds(60 * 60 * 24))
        server.stop()
        try await group.shutdownGracefully()
    }
}
