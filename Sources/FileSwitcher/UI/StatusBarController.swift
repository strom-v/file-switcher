import AppKit

/// Иконка в строке меню: открыть окно, остановить или запустить прокси, выйти
@MainActor
final class StatusBarController: NSObject, NSMenuDelegate {
    private let runtime: AppRuntime
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let menu = NSMenu()
    /// Показать главное окно приложения
    var onShowWindow: (() -> Void)?

    init(runtime: AppRuntime) {
        self.runtime = runtime
        super.init()
        statusItem.button?.image = AppTheme.symbol("arrow.triangle.2.circlepath", size: 14, weight: .medium)
        statusItem.button?.toolTip = "FileSwitcher"

        menu.delegate = self
        let openItem = NSMenuItem(title: "Открыть FileSwitcher", action: #selector(showWindow), keyEquivalent: "")
        openItem.target = self
        menu.addItem(openItem)
        menu.addItem(.separator())
        let toggleItem = NSMenuItem(title: "Запустить прокси", action: #selector(toggleProxy), keyEquivalent: "")
        toggleItem.target = self
        menu.addItem(toggleItem)
        menu.addItem(.separator())
        let quitItem = NSMenuItem(title: "Завершить FileSwitcher", action: #selector(quit), keyEquivalent: "")
        quitItem.target = self
        menu.addItem(quitItem)
        statusItem.menu = menu
    }

    /// Обновляет пункт состояния перед показом меню
    func menuNeedsUpdate(_ menu: NSMenu) {
        let running = runtime.controller?.state.status == .running
        let item = menu.item(at: 2)
        item?.title = running ? "Остановить прокси" : "Запустить прокси"
        item?.image = AppTheme.symbol(running ? "stop.fill" : "play.fill", size: 12)
    }

    /// Открывает главное окно
    @objc private func showWindow() {
        onShowWindow?()
    }

    /// Запускает или останавливает прокси
    @objc private func toggleProxy() {
        guard let controller = runtime.controller else {
            return
        }
        if controller.state.status == .running {
            controller.stop()
            return
        }
        controller.start(port: ProxyPortSettings.current)
    }

    /// Завершает приложение с корректным снятием системного прокси
    @objc private func quit() {
        NSApp.terminate(nil)
    }
}
