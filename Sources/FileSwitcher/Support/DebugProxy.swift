import Foundation
import NIOCore
import NIOPosix

/// Прокси без интерфейса: ручной прогон движка на порту (`--proxy <порт> [--rules <файл>]`)
enum DebugProxy {
    /// Поднимает прокси и пишет события в файл сессии
    static func run(port: Int, rulesFile: URL? = nil) async throws {
        let authority = try CertificateAuthority()
        let group = MultiThreadedEventLoopGroup(numberOfThreads: System.coreCount)
        let store = LogStore()
        let engine: (any RuleEngine)? = rulesFile.map { url in
            RuleMatcher(rulesFilePath: url) { message in
                SelfTest.writeError(message)
            }
        }
        let server = ProxyServer(
            authority: authority,
            group: group,
            ruleEngine: engine,
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
