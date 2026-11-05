import Foundation

/// Диагностика системной интеграции: доверие к CA, сетевые сервисы, VPN, правило sudoers
enum SystemCheck {
    /// Печатает состояние системной части
    static func run() async {
        let certStatus = await CertTrustDarwin.status()
        print("сертификат CA: \(certStatus.rawValue)")

        let services = (try? await NetworkServices.activeServices()) ?? []
        print("активные сетевые сервисы: \(services.isEmpty ? "нет" : services.joined(separator: ", "))")
        for service in services {
            if let state = try? await NetworkServices.proxyState(of: service) {
                print("  \(service): web=\(state.web.enabled ? "on" : "off") \(state.web.server):\(state.web.port), secure=\(state.secureWeb.enabled ? "on" : "off") \(state.secureWeb.server):\(state.secureWeb.port)")
            }
        }

        let vpn = await VpnDetector.status()
        let defaultInterface = await VpnDetector.defaultRouteInterface() ?? "нет"
        print("VPN: active=\(vpn.active) blocksProxy=\(vpn.blocksProxy), дефолтный интерфейс: \(defaultInterface)")

        let systemProxy = SystemProxyDarwin()
        print("правило sudoers для networksetup: \(systemProxy.isPasswordlessSetup() ? "установлено" : "не установлено")")
        let savedStates = NetworkServices.readSavedStates()
        print("сохранённое состояние прокси: \(savedStates.map { "\($0.count) сервисов" } ?? "нет")")
    }
}
