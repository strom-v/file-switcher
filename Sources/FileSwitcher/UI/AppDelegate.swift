import AppKit

/// Точка входа интерфейса: окно приложения и корректный откат системного прокси при выходе
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let runtime = AppRuntime.shared
    private var mainWindowController: MainWindowController?
    private var isTerminating = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        AppearanceSettings.applyStored()
        AppMenu.install(appDelegate: self)
        runtime.controller?.recoverStaleSystemProxy()
        let controller = MainWindowController(runtime: runtime)
        mainWindowController = controller
        controller.showWindow(nil)
        controller.startProxyIfNeeded()
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Открывает настройки из меню приложения
    @objc func showSettings(_ sender: Any?) {
        mainWindowController?.showSettings()
    }

    /// Переключает тему оформления выбранным пунктом меню
    @objc func selectAppearance(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String, let mode = AppearanceSettings.Mode(rawValue: raw) else {
            return
        }
        AppearanceSettings.apply(mode)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !isTerminating else {
            return .terminateNow
        }
        isTerminating = true
        // без ожидания откат системного прокси не успеет выполниться до выхода процесса
        Task { @MainActor in
            await runtime.controller?.stopAndWait()
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }
}

extension AppDelegate: NSMenuItemValidation {
    /// Отмечает галочкой выбранную тему в меню «Вид»
    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        guard let raw = menuItem.representedObject as? String,
              let mode = AppearanceSettings.Mode(rawValue: raw) else {
            return true
        }
        menuItem.state = AppearanceSettings.mode == mode ? .on : .off
        return true
    }
}
