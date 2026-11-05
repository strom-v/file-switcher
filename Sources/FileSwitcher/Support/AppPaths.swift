import Foundation

/// Пути данных приложения: те же, что были у Electron-версии, чтобы правила и журнал продолжились
enum AppPaths {
    /// `~/Library/Application Support/FileSwitcher`
    static var supportDirectory: URL {
        homeDirectory.appendingPathComponent("Library/Application Support/FileSwitcher", isDirectory: true)
    }

    /// Каталог журнала трафика
    static var trafficLogDirectory: URL {
        supportDirectory.appendingPathComponent("traffic-logs", isDirectory: true)
    }

    /// Файл правил
    static var rulesFile: URL {
        supportDirectory.appendingPathComponent("rules.json")
    }

    /// Исходное состояние системного прокси на время работы
    static var systemProxyStateFile: URL {
        supportDirectory.appendingPathComponent("proxy-system-state.json")
    }

    /// Каталог mitmproxy, где лежит уже выданный и доверенный CA
    static var mitmproxyDirectory: URL {
        homeDirectory.appendingPathComponent(".mitmproxy", isDirectory: true)
    }

    private static var homeDirectory: URL {
        FileManager.default.homeDirectoryForCurrentUser
    }
}
