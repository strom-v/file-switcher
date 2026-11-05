import Foundation
import Testing
@testable import FileSwitcher

/// Системная интеграция: разбор networksetup, правило sudoers, детект туннелей
@Suite("Системная интеграция")
struct SystemIntegrationTests {
    @Test("вывод networksetup разбирается на состояние прокси")
    func parseProxyState() {
        let output = """
        Enabled: Yes
        Server: 127.0.0.1
        Port: 38765
        Authenticated Proxy Enabled: 0
        """
        let state = NetworkServices.parse(output)
        #expect(state.enabled)
        #expect(state.server == "127.0.0.1")
        #expect(state.port == "38765")

        let disabled = NetworkServices.parse("Enabled: No\nServer: \nPort: 0\n")
        #expect(!disabled.enabled)
        #expect(disabled.port == "0")
    }

    @Test("восстановление возвращает прежний прокси или выключает его")
    func restoreCommands() {
        let saved = SavedProxyState(
            webEnabled: true,
            webServer: "proxy.corp",
            webPort: "3128",
            secureWebEnabled: false,
            secureWebServer: "",
            secureWebPort: ""
        )
        let commands = NetworkServices.restoreCommands(service: "Wi-Fi", saved: saved)
        #expect(commands.count == 2)
        #expect(commands[0] == ["-setwebproxy", "Wi-Fi", "proxy.corp", "3128"])
        #expect(commands[1] == ["-setsecurewebproxystate", "Wi-Fi", "off"])

        let enable = NetworkServices.enableCommands(service: "Wi-Fi", host: "127.0.0.1", port: 38765)
        #expect(enable == [
            ["-setwebproxy", "Wi-Fi", "127.0.0.1", "38765"],
            ["-setsecurewebproxy", "Wi-Fi", "127.0.0.1", "38765"]
        ])
    }

    @Test("правило sudoers узкое и привязано к пользователю")
    func sudoersRuleContent() {
        let rule = SystemProxyDarwin.sudoersRule(for: "vitaly")
        #expect(rule.hasPrefix("vitaly ALL=(root) NOPASSWD: "))
        #expect(rule.contains("/usr/sbin/networksetup -setwebproxy *"))
        #expect(!rule.contains("/usr/sbin/networksetup ALL"))
    }

    @Test("аргумент экранируется для shell")
    func shellQuoting() {
        #expect(SystemProxyDarwin.shellQuote("Wi-Fi") == "'Wi-Fi'")
        #expect(SystemProxyDarwin.shellQuote("a'b") == "'a'\\''b'")
    }

    @Test("туннельные интерфейсы распознаются по имени")
    func tunnelInterfaceNames() {
        #expect(VpnDetector.isTunnelInterface("utun7"))
        #expect(VpnDetector.isTunnelInterface("wg0"))
        #expect(!VpnDetector.isTunnelInterface("en0"))
        #expect(!VpnDetector.isTunnelInterface("utun"))
    }

    @Test("сохранённое состояние читается и удаляется")
    func savedStatesRoundTrip() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".json")
        defer {
            try? FileManager.default.removeItem(at: url)
        }
        let states: SavedProxyStates = [
            "Wi-Fi": SavedProxyState(
                webEnabled: false,
                webServer: "",
                webPort: "0",
                secureWebEnabled: false,
                secureWebServer: "",
                secureWebPort: "0"
            )
        ]
        try NetworkServices.writeSavedStates(states, to: url)
        #expect(NetworkServices.readSavedStates(from: url) == states)
        NetworkServices.clearSavedStates(at: url)
        #expect(NetworkServices.readSavedStates(from: url) == nil)
    }
}
