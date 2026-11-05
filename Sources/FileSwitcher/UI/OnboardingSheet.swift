import AppKit

/// Подсказка по первому запуску: прокси, сертификат и беспарольное переключение
@MainActor
final class OnboardingSheet: NSViewController {
    private static let doneKey = "FileSwitcher.onboardingDone"

    /// Нужно ли показать подсказку при этом запуске
    static var shouldShow: Bool {
        !UserDefaults.standard.bool(forKey: doneKey)
    }

    private let runtime: AppRuntime
    private let certLabel = makeLabel("", font: AppTheme.compactFont, color: .secondaryLabelColor)
    private let sudoersLabel = makeLabel("", font: AppTheme.compactFont, color: .secondaryLabelColor)

    private lazy var certButton = ClosureButton(title: "Доверять") { [weak self] in
        self?.trustCertificate()
    }

    private lazy var sudoersButton = ClosureButton(title: "Установить") { [weak self] in
        self?.setUpPasswordless()
    }

    init(runtime: AppRuntime) {
        self.runtime = runtime
        super.init(nibName: nil, bundle: nil)
        preferredContentSize = NSSize(width: 520, height: 320)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) не используется")
    }

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 520, height: 320))
        buildLayout()
        refreshStatuses()
    }
}


extension OnboardingSheet {
    /// Собирает шаги настройки и кнопку закрытия
    private func buildLayout() {
        let title = makeLabel("Первые шаги", font: NSFont.systemFont(ofSize: 15, weight: .semibold))
        let port = ProxyPortSettings.current
        let intro = makeLabel(
            "Прокси слушает 127.0.0.1:\(port) и прописан системным. Осталось два действия.",
            font: AppTheme.baseFont,
            color: .secondaryLabelColor
        )
        intro.lineBreakMode = .byWordWrapping
        intro.maximumNumberOfLines = 2

        let certStep = makeStep(
            title: "Доверие сертификату",
            text: "Без доверия к сертификату прокси не откроются HTTPS-сайты.",
            status: certLabel,
            button: certButton
        )
        let sudoersStep = makeStep(
            title: "Пароль администратора",
            text: "Правило sudoers избавит от запроса пароля при каждом запуске.",
            status: sudoersLabel,
            button: sudoersButton
        )
        let firefoxNote = makeLabel(
            "Firefox использует своё хранилище сертификатов - сертификат добавляется там вручную.",
            font: AppTheme.compactFont,
            color: .tertiaryLabelColor
        )
        firefoxNote.lineBreakMode = .byWordWrapping
        firefoxNote.maximumNumberOfLines = 2

        let doneButton = ClosureButton(title: "Понятно") { [weak self] in
            UserDefaults.standard.set(true, forKey: OnboardingSheet.doneKey)
            self?.dismiss(nil)
        }
        doneButton.keyEquivalent = "\r"

        let column = makeColumn(
            [title, intro, certStep, sudoersStep, firefoxNote, makeRow([makeSpacer(), doneButton], spacing: 8)],
            spacing: 12
        )
        column.alignment = .leading
        view.addSubview(column)
        column.pinEdges(to: view, insets: NSEdgeInsets(top: 16, left: 18, bottom: 16, right: 18))
        NSLayoutConstraint.activate([
            intro.widthAnchor.constraint(equalTo: column.widthAnchor),
            certStep.widthAnchor.constraint(equalTo: column.widthAnchor),
            sudoersStep.widthAnchor.constraint(equalTo: column.widthAnchor),
            firefoxNote.widthAnchor.constraint(equalTo: column.widthAnchor)
        ])
    }

    /// Строка шага: заголовок, пояснение, состояние и кнопка
    private func makeStep(title: String, text: String, status: NSTextField, button: NSButton) -> NSView {
        let titleLabel = makeLabel(title, font: NSFont.systemFont(ofSize: 12, weight: .semibold))
        let textLabel = makeLabel(text, font: AppTheme.compactFont, color: .secondaryLabelColor)
        textLabel.lineBreakMode = .byWordWrapping
        textLabel.maximumNumberOfLines = 2
        let texts = makeColumn([titleLabel, textLabel, status], spacing: 2)
        texts.alignment = .leading
        let row = makeRow([texts, makeSpacer(), button], spacing: 10)
        row.distribution = .fill
        texts.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        textLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return row
    }
}


extension OnboardingSheet {
    /// Читает текущее состояние сертификата и правила sudoers
    private func refreshStatuses() {
        Task { [weak self] in
            guard let self else {
                return
            }
            switch await CertTrustDarwin.status() {
            case .notGenerated:
                certLabel.stringValue = "Сертификат ещё не создан"
                certButton.title = "Создать"
            case .notTrusted:
                certLabel.stringValue = "Сертификат не доверен системе"
                certButton.title = "Доверять"
            case .trusted:
                certLabel.stringValue = "Сертификат доверен системе"
                certButton.title = "Убрать доверие"
            }
            let installed = runtime.systemProxy.isPasswordlessSetup()
            sudoersLabel.stringValue = installed ? "Правило установлено" : "Правило не установлено"
            sudoersButton.title = installed ? "Отозвать" : "Установить"
        }
    }

    /// Ставит или снимает доверие к сертификату
    private func trustCertificate() {
        certButton.isEnabled = false
        Task { [weak self] in
            guard let self else {
                return
            }
            do {
                switch await CertTrustDarwin.status() {
                case .trusted:
                    try await CertTrustDarwin.removeTrust()
                case .notTrusted, .notGenerated:
                    try await CertTrustDarwin.install()
                }
            } catch {
                showAlert("Не удалось изменить доверие", error.localizedDescription)
            }
            certButton.isEnabled = true
            refreshStatuses()
        }
    }

    /// Ставит или снимает правило sudoers
    private func setUpPasswordless() {
        sudoersButton.isEnabled = false
        let isInstalled = runtime.systemProxy.isPasswordlessSetup()
        Task { [weak self] in
            guard let self else {
                return
            }
            do {
                if isInstalled {
                    try await runtime.systemProxy.revokePasswordless()
                } else {
                    try await runtime.systemProxy.setUpPasswordless()
                }
            } catch {
                showAlert("Не удалось настроить sudoers", error.localizedDescription)
            }
            sudoersButton.isEnabled = true
            refreshStatuses()
        }
    }

    /// Показывает короткое модальное сообщение
    private func showAlert(_ title: String, _ text: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = text
        alert.addButton(withTitle: "Ок")
        alert.runModal()
    }
}
