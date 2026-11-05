import Foundation

/// Состояние VPN: есть ли активное подключение и ломает ли оно перехват системного прокси
struct VpnStatus: Sendable, Equatable {
    var active: Bool
    var blocksProxy: Bool
}

/// Системный прокси macOS: включение, откат и настройка беспарольного networksetup
final class SystemProxyDarwin: SystemProxyControlling, @unchecked Sendable {
    /// Файл правила sudoers для четырёх подкоманд networksetup
    static let sudoersFile = "/etc/sudoers.d/filesswitcher-networksetup"

    private let stateFile: URL

    init(stateFile: URL = AppPaths.systemProxyStateFile) {
        self.stateFile = stateFile
    }

    /// true, если в файле sudoers есть актуальное правило для текущего пользователя
    func isPasswordlessSetup() -> Bool {
        guard let content = try? String(contentsOfFile: Self.sudoersFile, encoding: .utf8) else {
            return false
        }
        return content.contains(Self.sudoersRule(for: currentUserName()))
    }

    /// Устанавливает правило passwordless для networksetup через один диалог авторизации
    func setUpPasswordless() async throws {
        let rule = Self.sudoersRule(for: currentUserName())
        let encodedRule = Data((rule + "\n").utf8).base64EncodedString()
        let script = [
            "tmp_file=$(/usr/bin/mktemp /etc/sudoers.d/.filesswitcher-networksetup.XXXXXX)",
            "trap '/bin/rm -f \"$tmp_file\"' EXIT",
            "/usr/bin/printf %s \(Self.shellQuote(encodedRule)) | /usr/bin/base64 -D > \"$tmp_file\"",
            "/bin/chmod 440 \"$tmp_file\"",
            "/usr/sbin/chown root:wheel \"$tmp_file\"",
            "/usr/sbin/visudo -c -f \"$tmp_file\"",
            "/bin/mv -f \"$tmp_file\" \(Self.shellQuote(Self.sudoersFile))",
            "trap - EXIT"
        ].joined(separator: " && ")
        try await Self.runAsAdmin(script)
    }

    /// Отзывает правило passwordless
    func revokePasswordless() async throws {
        guard FileManager.default.fileExists(atPath: Self.sudoersFile) else {
            return
        }
        try await Self.runAsAdmin("rm -f \"\(Self.sudoersFile)\"")
    }

    /// Включает системный прокси на всех активных сервисах, сохранив исходное состояние
    func enable(host: String, port: Int) async throws {
        if let saved = NetworkServices.readSavedStates(from: stateFile), !saved.isEmpty {
            throw SystemProxyError.stateNotRestored
        }
        let services = try await NetworkServices.activeServices()
        guard !services.isEmpty else {
            throw SystemProxyError.noActiveServices
        }

        var states: SavedProxyStates = [:]
        var commands: [[String]] = []
        for service in services {
            let state = try await NetworkServices.proxyState(of: service)
            states[service] = SavedProxyState(
                webEnabled: state.web.enabled,
                webServer: state.web.server,
                webPort: state.web.port,
                secureWebEnabled: state.secureWeb.enabled,
                secureWebServer: state.secureWeb.server,
                secureWebPort: state.secureWeb.port
            )
            commands.append(contentsOf: NetworkServices.enableCommands(service: service, host: host, port: port))
        }
        try NetworkServices.writeSavedStates(states, to: stateFile)
        try await Self.execAsAdmin(commands)
    }

    /// Возвращает системный прокси в состояние до запуска
    func disable() async throws {
        guard let states = NetworkServices.readSavedStates(from: stateFile), !states.isEmpty else {
            NetworkServices.clearSavedStates(at: stateFile)
            return
        }
        try await Self.execAsAdmin(NetworkServices.restoreCommands(for: states))
        NetworkServices.clearSavedStates(at: stateFile)
    }

    /// Восстанавливает системный прокси после аварийного завершения прошлого запуска
    func recoverStale(host: String) async throws {
        if let states = NetworkServices.readSavedStates(from: stateFile), !states.isEmpty {
            try await Self.execAsAdmin(NetworkServices.restoreCommands(for: states))
            NetworkServices.clearSavedStates(at: stateFile)
            return
        }
        let services = try await NetworkServices.activeServices()
        var commands: [[String]] = []
        for service in services {
            let state = try await NetworkServices.proxyState(of: service)
            if state.web.enabled, state.web.server == host {
                commands.append(["-setwebproxystate", service, "off"])
            }
            if state.secureWeb.enabled, state.secureWeb.server == host {
                commands.append(["-setsecurewebproxystate", service, "off"])
            }
        }
        guard !commands.isEmpty else {
            return
        }
        try await Self.execAsAdmin(commands)
    }

    /// Правило sudoers: passwordless только для четырёх подкоманд networksetup, не для всего бинарника
    static func sudoersRule(for username: String) -> String {
        let commands = [
            "/usr/sbin/networksetup -setwebproxy *",
            "/usr/sbin/networksetup -setsecurewebproxy *",
            "/usr/sbin/networksetup -setwebproxystate *",
            "/usr/sbin/networksetup -setsecurewebproxystate *"
        ].joined(separator: ", ")
        return "\(username) ALL=(root) NOPASSWD: \(commands)"
    }

    /// Экранирует один аргумент для вставки в POSIX-shell строку
    static func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    /// Имя текущего пользователя
    func currentUserName() -> String {
        NSUserName()
    }

    /// Выполняет команды networksetup с правами администратора: сперва `sudo -n`, при неудаче -
    /// один системный диалог авторизации
    static func execAsAdmin(_ commands: [[String]]) async throws {
        var usedSudo = true
        for arguments in commands {
            let result = await ProcessRunner.runIgnoringFailure("/usr/bin/sudo", ["-n", "/usr/sbin/networksetup"] + arguments)
            if result.status != 0 {
                usedSudo = false
                break
            }
        }
        guard !usedSudo else {
            return
        }
        // do shell script принимает только строку - здесь обязателен ручной quoting каждого аргумента
        let combined = commands
            .map { arguments in
                (["/usr/sbin/networksetup"] + arguments).map(shellQuote).joined(separator: " ")
            }
            .joined(separator: " && ")
        try await runAsAdmin(combined)
    }

    /// Выполняет shell-скрипт с правами администратора через один системный диалог
    static func runAsAdmin(_ script: String) async throws {
        let escaped = script
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        _ = try await ProcessRunner.run(
            "/usr/bin/osascript",
            ["-e", "do shell script \"\(escaped)\" with administrator privileges"]
        )
    }
}

/// Определение активного VPN: подключённый сервис, туннельный интерфейс или корпоративный клиент
enum VpnDetector {
    /// Состояние VPN: активность и признак full-tunnel
    static func status() async -> VpnStatus {
        async let defaultInterface = defaultRouteInterface()
        async let byService = hasConnectedVpnService()
        async let tunnels = activeTunnelInterfaces()
        async let byCorpProcess = hasCorpVpnProcess()

        let tunnelInterfaces = await tunnels
        let serviceActive = await byService
        let processActive = await byCorpProcess
        let active = serviceActive || processActive || !tunnelInterfaces.isEmpty
        let defaultRoute = await defaultInterface
        let blocksProxy = defaultRoute.map { name in
            isTunnelInterface(name) || tunnelInterfaces.contains(name)
        } ?? false
        return VpnStatus(active: active, blocksProxy: blocksProxy)
    }

    /// Имя интерфейса дефолтного маршрута
    static func defaultRouteInterface() async -> String? {
        let result = await ProcessRunner.runIgnoringFailure("/sbin/route", ["-n", "get", "default"])
        guard result.status == 0 else {
            return nil
        }
        for line in result.output.split(separator: "\n") where line.contains("interface:") {
            let parts = line.split(separator: ":", maxSplits: 1)
            guard parts.count == 2 else {
                continue
            }
            return parts[1].trimmingCharacters(in: .whitespaces)
        }
        return nil
    }

    /// Есть ли подключённый VPN-сервис по данным scutil
    static func hasConnectedVpnService() async -> Bool {
        let result = await ProcessRunner.runIgnoringFailure("/usr/sbin/scutil", ["--nc", "list"])
        guard result.status == 0 else {
            return false
        }
        return result.output.split(separator: "\n").contains { line in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            return trimmed.hasPrefix("(Connected)") || trimmed.hasPrefix("* (Connected)")
        }
    }

    /// Активные туннельные интерфейсы с реальным (не link-local) IPv4
    static func activeTunnelInterfaces() async -> [String] {
        let result = await ProcessRunner.runIgnoringFailure("/sbin/ifconfig", [])
        guard result.status == 0 else {
            return []
        }
        var interfaces: [String] = []
        for block in result.output.components(separatedBy: "\n\n") {
            guard let firstLine = block.split(separator: "\n").first else {
                continue
            }
            guard let name = firstLine.split(separator: ":").first.map(String.init), isTunnelInterface(name) else {
                continue
            }
            let hasRealIPv4 = block.split(separator: "\n").contains { line in
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                return trimmed.hasPrefix("inet ") && !trimmed.hasPrefix("inet 169.254")
            }
            if hasRealIPv4 {
                interfaces.append(name)
            }
        }
        return interfaces
    }

    /// Корпоративные VPN-клиенты, которые не видны в scutil
    static func hasCorpVpnProcess() async -> Bool {
        let result = await ProcessRunner.runIgnoringFailure("/bin/ps", ["-Ao", "comm="])
        guard result.status == 0 else {
            return false
        }
        let markers = ["GlobalProtect", "Cisco Secure Client", "AnyConnect", "vpnagentd", "Zscaler", "NetExtender", "Ivanti"]
        return markers.contains { result.output.contains($0) }
    }

    /// Туннельный ли это интерфейс по имени
    static func isTunnelInterface(_ name: String) -> Bool {
        let prefixes = ["utun", "ppp", "ipsec", "tap", "tun", "wg"]
        guard let prefix = prefixes.first(where: { name.hasPrefix($0) }) else {
            return false
        }
        let suffix = name.dropFirst(prefix.count)
        return !suffix.isEmpty && suffix.allSatisfy(\.isNumber)
    }
}

/// Ошибки системного прокси
enum SystemProxyError: LocalizedError {
    case stateNotRestored
    case noActiveServices

    var errorDescription: String? {
        switch self {
        case .stateNotRestored:
            return "Сохранённое состояние системного прокси нужно сначала восстановить"
        case .noActiveServices:
            return "Нет активных сетевых сервисов - системный прокси не применён ни к одному интерфейсу"
        }
    }
}
