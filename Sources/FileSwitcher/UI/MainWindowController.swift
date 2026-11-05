import AppKit

/// Порт прокси, сохранённый между запусками
@MainActor
enum ProxyPortSettings {
    private static let key = "FileSwitcher.proxyPort"

    /// Текущий порт из настроек
    static var current: Int {
        let stored = UserDefaults.standard.integer(forKey: key)
        return stored > 0 ? stored : defaultProxyPort
    }

    /// Сохраняет порт
    static func save(_ port: Int) {
        UserDefaults.standard.set(port, forKey: key)
    }
}

/// Главное окно: шапка с управлением прокси, журнал слева и правила справа
@MainActor
final class MainWindowController: NSWindowController {
    private let runtime: AppRuntime
    private let trafficController: TrafficViewController
    private let rulesController: RulesViewController
    private let rootController = NSViewController()

    private let statusDot = NSView()
    private let statusLabel = makeLabel("", font: AppTheme.compactBoldFont)
    private let portLabel = makeLabel("", font: AppTheme.monoFont, color: .tertiaryLabelColor)
    private let warningBanner = NSView()
    private let warningLabel = makeLabel("", font: AppTheme.compactFont)
    private let splitView = NSSplitView()
    private var warningHideTask: Task<Void, Never>?

    private lazy var startStopButton = FilledIconButton(
        symbol: "play.fill",
        tooltip: L10n.t("Запустить прокси"),
        fillColor: AppTheme.success,
        target: self,
        action: #selector(toggleProxy)
    )

    init(runtime: AppRuntime) {
        self.runtime = runtime
        trafficController = TrafficViewController(runtime: runtime)
        rulesController = RulesViewController(runtime: runtime)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1080, height: 700),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "FileSwitcher"
        window.titleVisibility = .hidden
        window.minSize = NSSize(width: 820, height: 520)
        window.tabbingMode = .disallowed
        window.isReleasedWhenClosed = false
        window.center()
        super.init(window: window)

        rootController.view = NSView(frame: window.contentLayoutRect)
        window.contentViewController = rootController
        rootController.addChild(trafficController)
        rootController.addChild(rulesController)
        buildLayout()
        bindRuntime()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) не используется")
    }

    /// Запускает прокси при открытии окна
    func startProxyIfNeeded() {
        guard let controller = runtime.controller, controller.state.status == .stopped else {
            return
        }
        controller.start(port: ProxyPortSettings.current)
    }

    /// Показывает подсказку по первому запуску
    func presentOnboardingIfNeeded() {
        guard OnboardingSheet.shouldShow else {
            return
        }
        rootController.presentAsSheet(OnboardingSheet(runtime: runtime))
    }

}
extension MainWindowController {
    /// Собирает шапку, полосу предупреждений и две панели рядом
    private func buildLayout() {
        statusDot.wantsLayer = true
        statusDot.layer?.cornerRadius = 4
        statusDot.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            statusDot.widthAnchor.constraint(equalToConstant: 8),
            statusDot.heightAnchor.constraint(equalToConstant: 8)
        ])

        let settingsButton = ClosureButton(symbol: "gearshape") { [weak self] in
            self?.showSettings()
        }
        settingsButton.isBordered = false
        settingsButton.toolTip = L10n.t("Настройки")

        let header = makeRow(
            [statusDot, statusLabel, portLabel, makeSpacer(), settingsButton, startStopButton],
            spacing: 8
        )
        header.distribution = .fill

        warningBanner.wantsLayer = true
        warningBanner.layer?.backgroundColor = AppTheme.warningBanner.cgColor
        warningBanner.layer?.cornerRadius = 4
        warningBanner.isHidden = true
        warningBanner.translatesAutoresizingMaskIntoConstraints = false
        warningBanner.addSubview(warningLabel)
        warningLabel.pinEdges(to: warningBanner, insets: NSEdgeInsets(top: 6, left: 8, bottom: 6, right: 8))

        splitView.isVertical = true
        splitView.dividerStyle = .thin
        splitView.translatesAutoresizingMaskIntoConstraints = false
        splitView.autosaveName = "FileSwitcher.MainSplit"
        splitView.addArrangedSubview(trafficController.view)
        splitView.addArrangedSubview(rulesController.view)

        let column = makeColumn([header, warningBanner, splitView], spacing: 6)
        rootController.view.addSubview(column)
        column.pinEdges(to: rootController.view, insets: NSEdgeInsets(top: 8, left: 8, bottom: 8, right: 8))
        NSLayoutConstraint.activate([
            header.widthAnchor.constraint(equalTo: column.widthAnchor),
            warningBanner.widthAnchor.constraint(equalTo: column.widthAnchor),
            splitView.widthAnchor.constraint(equalTo: column.widthAnchor),
            splitView.heightAnchor.constraint(greaterThanOrEqualToConstant: 320)
        ])
    }

    /// Связывает панели между собой и подписывается на состояние прокси
    private func bindRuntime() {
        trafficController.onCreateRule = { [weak self] event in
            self?.rulesController.addRule(from: event)
        }
        trafficController.onWarning = { [weak self] message in
            self?.showWarning(message)
        }
        runtime.controller?.onStateChange = { [weak self] state in
            self?.updateStatus(state)
        }
        let state = runtime.controller?.state ?? ProxyState(status: .stopped, port: ProxyPortSettings.current)
        updateStatus(state)
        refreshVpnState()
        if let error = runtime.startupError {
            showWarning(error)
        }
    }
}


extension MainWindowController {
    /// Обновляет индикатор состояния и кнопку запуска
    private func updateStatus(_ state: ProxyState) {
        portLabel.stringValue = "127.0.0.1:\(state.port)"
        switch state.status {
        case .stopped:
            statusLabel.stringValue = L10n.t("остановлен")
            statusLabel.textColor = .secondaryLabelColor
            statusDot.layer?.backgroundColor = NSColor.tertiaryLabelColor.cgColor
            setStartStop(isRunning: false, enabled: true)
        case .starting:
            statusLabel.stringValue = L10n.t("запускается")
            statusLabel.textColor = .secondaryLabelColor
            statusDot.layer?.backgroundColor = AppTheme.warning.cgColor
            setStartStop(isRunning: false, enabled: false)
        case .running:
            statusLabel.stringValue = L10n.t("работает")
            statusLabel.textColor = .secondaryLabelColor
            statusDot.layer?.backgroundColor = AppTheme.success.cgColor
            setStartStop(isRunning: true, enabled: true)
        case .crashed:
            statusLabel.stringValue = L10n.t("ошибка запуска")
            statusLabel.textColor = AppTheme.danger
            statusDot.layer?.backgroundColor = AppTheme.danger.cgColor
            setStartStop(isRunning: false, enabled: true)
        }
        startStopButton.toolTip = state.error
            ?? (state.status == .running ? L10n.t("Остановить прокси") : L10n.t("Запустить прокси"))
    }

    /// Переключает вид кнопки запуска и остановки
    private func setStartStop(isRunning: Bool, enabled: Bool) {
        startStopButton.image = AppTheme.symbol(isRunning ? "stop.fill" : "play.fill", size: 12, weight: .bold)
        startStopButton.fillColor = isRunning ? AppTheme.danger : AppTheme.success
        startStopButton.isEnabled = enabled
    }

    /// Показывает полосу предупреждения на несколько секунд
    private func showWarning(_ message: String) {
        warningLabel.stringValue = message
        warningBanner.layer?.backgroundColor = AppTheme.warningBanner.cgColor
        warningBanner.isHidden = false
        warningHideTask?.cancel()
        warningHideTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(8))
            guard !Task.isCancelled else {
                return
            }
            self?.warningBanner.isHidden = true
        }
    }

    /// Показывает или скрывает полосу про full-tunnel VPN
    private func refreshVpnState() {
        Task { [weak self] in
            let vpn = await VpnDetector.status()
            guard let self else {
                return
            }
            guard vpn.blocksProxy else {
                return
            }
            warningLabel.stringValue = L10n.t("Активный VPN перехватывает трафик - прокси не увидит запросы")
            warningBanner.layer?.backgroundColor = AppTheme.errorBanner.cgColor
            warningBanner.isHidden = false
            warningHideTask?.cancel()
        }
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

    /// Перезапускает прокси на сохранённом порту
    private func restartProxy() {
        guard let controller = runtime.controller else {
            return
        }
        Task { @MainActor in
            await controller.stopAndWait()
            controller.start(port: ProxyPortSettings.current)
        }
    }

    /// Открывает панель настроек
    func showSettings() {
        let settings = SettingsSheet(runtime: runtime)
        settings.onPortChange = { port in
            ProxyPortSettings.save(port)
        }
        settings.onRestart = { [weak self] in
            self?.restartProxy()
        }
        settings.onRulesChanged = { [weak self] in
            self?.rulesController.reloadRules()
        }
        rootController.presentAsSheet(settings)
    }
}
