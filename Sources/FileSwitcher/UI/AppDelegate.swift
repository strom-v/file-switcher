import AppKit

/// Точка входа интерфейса: окно приложения и корректный откат системного прокси при выходе
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let runtime = AppRuntime.shared
    private var mainWindowController: MainWindowController?
    private var isTerminating = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        runtime.controller?.recoverStaleSystemProxy()
        let controller = MainWindowController(runtime: runtime)
        mainWindowController = controller
        controller.showWindow(nil)
        controller.startProxyIfNeeded()
        NSApp.activate(ignoringOtherApps: true)
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
