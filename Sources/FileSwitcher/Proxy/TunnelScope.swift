import Foundation

/// Какие хосты прокси расшифровывает: все, только из списка или все, кроме списка
enum TunnelScope {
    /// Режим области перехвата, rawValue хранится в настройках
    enum Mode: Int {
        case all = 0
        case only = 1
        case except = 2
    }

    static let modeKey = "FileSwitcher.mitmScope"
    static let hostsKey = "FileSwitcher.mitmHosts"

    /// Текущий режим из настроек
    static var mode: Mode {
        Mode(rawValue: UserDefaults.standard.integer(forKey: modeKey)) ?? .all
    }

    /// Список хостов из настроек
    static var hosts: [String] {
        let raw = UserDefaults.standard.string(forKey: hostsKey) ?? ""
        return raw
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
            .filter { !$0.isEmpty }
    }

    /// Сохраняет режим и список хостов
    static func save(mode: Mode, hosts: [String]) {
        UserDefaults.standard.set(mode.rawValue, forKey: modeKey)
        UserDefaults.standard.set(hosts.joined(separator: ", "), forKey: hostsKey)
    }

    /// Нужно ли расшифровывать трафик этого хоста
    static func shouldIntercept(host: String) -> Bool {
        let current = mode
        let list = hosts
        guard !list.isEmpty else {
            return current != .only
        }
        let matched = list.contains { matches($0, host: host.lowercased()) }
        return current == .only ? matched : !matched
    }

    /// Совпадение хоста с шаблоном: точное имя, *.example.com или * для всех
    private static func matches(_ pattern: String, host: String) -> Bool {
        if pattern == "*" {
            return true
        }
        if pattern.hasPrefix("*.") {
            let suffix = String(pattern.dropFirst())
            return host.hasSuffix(suffix) || host == String(pattern.dropFirst(2))
        }
        return host == pattern
    }
}
