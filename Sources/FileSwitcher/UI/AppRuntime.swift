import Foundation
import NIOCore
import NIOPosix

/// Общие зависимости приложения: прокси, правила, журнал и системные настройки
@MainActor
final class AppRuntime {
    static let shared = AppRuntime()

    let group: MultiThreadedEventLoopGroup
    let authority: CertificateAuthority?
    let store: LogStore
    let rulesStore: RulesStore
    let systemProxy: SystemProxyDarwin
    let controller: ProxyController?
    /// Причина, по которой прокси не может работать (нет материала CA)
    let startupError: String?

    private init() {
        let group = MultiThreadedEventLoopGroup(numberOfThreads: System.coreCount)
        self.group = group
        let store = LogStore()
        self.store = store
        let rulesStore = RulesStore()
        self.rulesStore = rulesStore
        let systemProxy = SystemProxyDarwin()
        self.systemProxy = systemProxy

        var loadedAuthority: CertificateAuthority?
        var startupMessage: String?
        do {
            loadedAuthority = try CertificateAuthority()
        } catch {
            startupMessage = String(format: L10n.t("Нет сертификата прокси: %@"), error.localizedDescription)
        }
        authority = loadedAuthority
        startupError = startupMessage

        if let loadedAuthority {
            controller = ProxyController(
                authority: loadedAuthority,
                group: group,
                store: store,
                systemProxy: systemProxy,
                makeRuleEngine: {
                    RuleMatcher(rulesFilePath: AppPaths.rulesFile) { message in
                        FileHandle.standardError.write(Data((message + "\n").utf8))
                    }
                }
            )
        } else {
            controller = nil
        }
    }
}
