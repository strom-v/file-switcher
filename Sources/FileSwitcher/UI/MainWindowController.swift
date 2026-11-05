import AppKit

/// Главное окно приложения с вкладками трафика и правил
@MainActor
final class MainWindowController: NSWindowController {
    private let runtime: AppRuntime
    private let trafficController: TrafficViewController
    private let rulesController: RulesViewController

    init(runtime: AppRuntime) {
        self.runtime = runtime
        trafficController = TrafficViewController(runtime: runtime)
        rulesController = RulesViewController(runtime: runtime)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 960, height: 620),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "FileSwitcher"
        window.minSize = NSSize(width: 760, height: 480)
        window.center()
        super.init(window: window)

        let tabView = NSTabView()
        tabView.translatesAutoresizingMaskIntoConstraints = false
        tabView.tabViewType = .topTabsBezelBorder

        let trafficItem = NSTabViewItem(identifier: "traffic")
        trafficItem.label = "Трафик"
        trafficItem.view = trafficController.view
        tabView.addTabViewItem(trafficItem)

        let rulesItem = NSTabViewItem(identifier: "rules")
        rulesItem.label = "Правила"
        rulesItem.view = rulesController.view
        tabView.addTabViewItem(rulesItem)

        let content = window.contentView ?? NSView()
        content.addSubview(tabView)
        NSLayoutConstraint.activate([
            tabView.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 10),
            tabView.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -10),
            tabView.topAnchor.constraint(equalTo: content.topAnchor, constant: 10),
            tabView.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -10)
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) не используется")
    }
}
