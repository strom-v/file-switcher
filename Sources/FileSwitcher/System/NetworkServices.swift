import Foundation

/// Состояние HTTP и HTTPS прокси одного сетевого сервиса до включения нашего прокси
struct SavedProxyState: Codable, Sendable, Equatable {
    var webEnabled: Bool
    var webServer: String
    var webPort: String
    var secureWebEnabled: Bool
    var secureWebServer: String
    var secureWebPort: String
}

/// Текущее состояние прокси сетевого сервиса
struct NetworkProxyState: Sendable, Equatable {
    var enabled: Bool
    var server: String
    var port: String
}

/// Сохранённые состояния всех сервисов: ключ — имя сервиса
typealias SavedProxyStates = [String: SavedProxyState]

/// Читает и записывает настройки сетевых сервисов через networksetup
enum NetworkServices {
    private static let networksetup = "/usr/sbin/networksetup"

    /// Активные сетевые сервисы macOS (Wi-Fi, Ethernet и прочие)
    static func activeServices() async throws -> [String] {
        let output = try await ProcessRunner.run(networksetup, ["-listallnetworkservices"])
        return output
            .split(separator: "\n")
            .dropFirst()
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && !$0.hasPrefix("*") }
    }

    /// Текущее состояние HTTP и HTTPS прокси сервиса
    static func proxyState(of service: String) async throws -> (web: NetworkProxyState, secureWeb: NetworkProxyState) {
        async let webOutput = ProcessRunner.run(networksetup, ["-getwebproxy", service])
        async let secureOutput = ProcessRunner.run(networksetup, ["-getsecurewebproxy", service])
        return (parse(try await webOutput), parse(try await secureOutput))
    }

    /// Команды полного состояния сервисов: state + выключение обеих прокси-схем
    static func enableCommands(service: String, host: String, port: Int) -> [[String]] {
        [
            ["-setwebproxy", service, host, String(port)],
            ["-setsecurewebproxy", service, host, String(port)]
        ]
    }

    /// Команды восстановления сервиса в сохранённое состояние
    static func restoreCommands(service: String, saved: SavedProxyState) -> [[String]] {
        var commands: [[String]] = []
        if saved.webEnabled, !saved.webServer.isEmpty {
            commands.append(["-setwebproxy", service, saved.webServer, saved.webPort])
        } else {
            commands.append(["-setwebproxystate", service, "off"])
        }
        if saved.secureWebEnabled, !saved.secureWebServer.isEmpty {
            commands.append(["-setsecurewebproxy", service, saved.secureWebServer, saved.secureWebPort])
        } else {
            commands.append(["-setsecurewebproxystate", service, "off"])
        }
        return commands
    }

    /// Команды восстановления всех сервисов
    static func restoreCommands(for states: SavedProxyStates) -> [[String]] {
        var commands: [[String]] = []
        for (service, saved) in states {
            commands.append(contentsOf: restoreCommands(service: service, saved: saved))
        }
        return commands
    }

    /// Разбирает вывод `-getwebproxy`: Enabled/Server/Port
    static func parse(_ output: String) -> NetworkProxyState {
        var enabled = false
        var server = ""
        var port = ""
        for line in output.split(separator: "\n") {
            let parts = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            guard parts.count == 2 else {
                continue
            }
            let name = parts[0].trimmingCharacters(in: .whitespaces).lowercased()
            let value = parts[1].trimmingCharacters(in: .whitespaces)
            switch name {
            case "enabled":
                enabled = value.lowercased() == "yes"
            case "server":
                server = value
            case "port":
                port = value
            default:
                break
            }
        }
        return NetworkProxyState(enabled: enabled, server: server, port: port)
    }

    /// Читает сохранённые состояния с диска
    static func readSavedStates(from url: URL = AppPaths.systemProxyStateFile) -> SavedProxyStates? {
        guard FileManager.default.fileExists(atPath: url.path) else {
            return nil
        }
        return try? JSONDecoder().decode(SavedProxyStates.self, from: Data(contentsOf: url))
    }

    /// Сохраняет состояния на диск: при падении приложения откат останется возможным
    static func writeSavedStates(_ states: SavedProxyStates, to url: URL = AppPaths.systemProxyStateFile) throws {
        try JsonFile.write(states, to: url)
    }

    /// Удаляет файл сохранённых состояний
    static func clearSavedStates(at url: URL = AppPaths.systemProxyStateFile) {
        try? FileManager.default.removeItem(at: url)
    }
}
