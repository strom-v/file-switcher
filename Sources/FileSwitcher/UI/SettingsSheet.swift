import AppKit
import UniformTypeIdentifiers

/// Панель настроек: порт, сертификат, sudoers, правила и экспорт журнала
@MainActor
final class SettingsSheet: NSViewController {
    /// Новый порт прокси
    var onPortChange: ((Int) -> Void)?
    /// Перезапуск прокси после смены порта
    var onRestart: (() -> Void)?
    /// Правила на диске изменились
    var onRulesChanged: (() -> Void)?

    private let runtime: AppRuntime
    private let portField = NSTextField(string: "\(ProxyPortSettings.current)")
    private let certLabel = makeLabel(L10n.t("проверка сертификата"), font: AppTheme.compactFont, color: .secondaryLabelColor)
    private let sudoersLabel = makeLabel(L10n.t("проверка настройки"), font: AppTheme.compactFont, color: .secondaryLabelColor)
    private let logFormatPopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let scopePopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let scopeField = NSTextField(string: "")
    private let languagePopup = NSPopUpButton(frame: .zero, pullsDown: false)

    private lazy var certButton = ClosureButton(title: L10n.t("Установить доверие")) { [weak self] in
        self?.toggleCert()
    }

    private lazy var sudoersButton = ClosureButton(title: L10n.t("Установить")) { [weak self] in
        self?.toggleSudoers()
    }

    init(runtime: AppRuntime) {
        self.runtime = runtime
        super.init(nibName: nil, bundle: nil)
        preferredContentSize = NSSize(width: 560, height: 640)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) не используется")
    }

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 560, height: 640))
        buildLayout()
        refreshCertStatus()
        refreshSudoersStatus()
    }
}


extension SettingsSheet {
    /// Собирает колонку секций внутри прокручиваемой области
    private func buildLayout() {
        let title = makeLabel(L10n.t("Настройки"), font: NSFont.systemFont(ofSize: 15, weight: .semibold))
        let doneButton = ClosureButton(title: L10n.t("Готово")) { [weak self] in
            self?.dismiss(nil)
        }
        doneButton.keyEquivalent = "\r"
        let header = makeRow([title, makeSpacer(), doneButton], spacing: 8)
        header.distribution = .fill

        portField.translatesAutoresizingMaskIntoConstraints = false
        portField.alignment = .right
        portField.widthAnchor.constraint(equalToConstant: 90).isActive = true

        let applyPortButton = ClosureButton(title: L10n.t("Применить")) { [weak self] in
            self?.applyPort()
        }
        let portRow = makeRow([makeLabel(L10n.t("Порт прокси"), font: AppTheme.baseFont), portField, applyPortButton], spacing: 8)

        scopePopup.translatesAutoresizingMaskIntoConstraints = false
        for title in [L10n.t("Расшифровывать все хосты"), L10n.t("Только хосты из списка"), L10n.t("Все, кроме хостов из списка")] {
            scopePopup.addItem(withTitle: title)
        }
        scopePopup.selectItem(at: TunnelScope.mode.rawValue)
        scopeField.stringValue = TunnelScope.hosts.joined(separator: ", ")
        scopeField.placeholderString = "example.com, *.internal.lan"
        scopeField.translatesAutoresizingMaskIntoConstraints = false
        scopeField.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let scopeButton = ClosureButton(title: L10n.t("Применить")) { [weak self] in
            self?.applyScope()
        }
        let scopeRow = makeRow([scopePopup, scopeField, scopeButton], spacing: 8)

        certButton.toolTip = L10n.t("Firefox использует своё хранилище сертификатов: CA придётся добавить вручную")

        let exportRulesButton = ClosureButton(title: L10n.t("Экспорт")) { [weak self] in
            self?.exportRules()
        }
        let importRulesButton = ClosureButton(title: L10n.t("Импорт")) { [weak self] in
            self?.importRules()
        }
        let refreshRulesButton = ClosureButton(title: L10n.t("Перезагрузить")) { [weak self] in
            self?.reloadRules()
        }
        let rulesRow = makeRow([exportRulesButton, importRulesButton, refreshRulesButton], spacing: 8)

        logFormatPopup.translatesAutoresizingMaskIntoConstraints = false
        for format in LogExportFormat.allCases {
            logFormatPopup.addItem(withTitle: format.rawValue.uppercased())
        }
        let exportLogButton = ClosureButton(title: L10n.t("Экспорт")) { [weak self] in
            self?.exportLog()
        }
        let logRow = makeRow([logFormatPopup, exportLogButton], spacing: 8)

        let openFolderButton = ClosureButton(title: L10n.t("Открыть папку данных")) { [weak self] in
            self?.openSupportFolder()
        }
        let revealLogButton = ClosureButton(title: L10n.t("Показать журнал")) { [weak self] in
            self?.revealLogFile()
        }
        let resetLogsButton = ClosureButton(title: L10n.t("Удалить журналы…")) { [weak self] in
            self?.resetLogs()
        }
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"
        let versionLabel = makeLabel("FileSwitcher \(version)", font: AppTheme.compactFont, color: .tertiaryLabelColor)
        languagePopup.translatesAutoresizingMaskIntoConstraints = false
        for language in L10n.Language.allCases {
            languagePopup.addItem(withTitle: language.title)
        }
        if let index = L10n.Language.allCases.firstIndex(of: L10n.language) {
            languagePopup.selectItem(at: index)
        }
        languagePopup.target = self
        languagePopup.action = #selector(changeLanguage)
        let languageRow = makeRow(
            [makeLabel(L10n.t("Язык интерфейса"), font: AppTheme.baseFont), languagePopup],
            spacing: 8
        )
        let folderLabel = makeLabel(
            MetaFormat.stripHome(AppPaths.supportDirectory.path),
            font: AppTheme.monoFont,
            color: .secondaryLabelColor
        )

        let sections: [NSView] = [
            header,
            makeSection(L10n.t("Сеть и сертификат"), views: [
                portRow,
                makeSeparator(),
                scopeRow,
                makeSeparator(),
                certLabel, certButton,
                makeSeparator(),
                sudoersLabel, sudoersButton
            ]),
            makeSection(L10n.t("Правила"), views: [rulesRow]),
            makeSection(L10n.t("Журнал"), views: [logRow]),
            makeSection(L10n.t("Данные"), views: [
                folderLabel,
                openFolderButton,
                makeRow([revealLogButton, resetLogsButton], spacing: 8)
            ]),
            makeSection(L10n.t("О программе"), views: [versionLabel, languageRow])
        ]

        let column = makeColumn(sections, spacing: 12)
        let scrollView = NSScrollView()
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.hasVerticalScroller = true
        scrollView.drawsBackground = false
        let documentView = NSView()
        documentView.translatesAutoresizingMaskIntoConstraints = false
        documentView.addSubview(column)
        scrollView.documentView = documentView
        view.addSubview(scrollView)

        NSLayoutConstraint.activate([
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.topAnchor.constraint(equalTo: view.topAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            documentView.widthAnchor.constraint(equalTo: scrollView.widthAnchor),
            column.leadingAnchor.constraint(equalTo: documentView.leadingAnchor, constant: 16),
            column.trailingAnchor.constraint(equalTo: documentView.trailingAnchor, constant: -16),
            column.topAnchor.constraint(equalTo: documentView.topAnchor, constant: 16),
            column.bottomAnchor.constraint(equalTo: documentView.bottomAnchor, constant: -16)
        ])
    }

    /// Заголовок секции и её содержимое
    private func makeSection(_ title: String, views: [NSView]) -> NSView {
        let header = makeLabel(title.uppercased(), font: AppTheme.groupFont, color: .secondaryLabelColor)
        return makeColumn([header] + views, spacing: 6)
    }

    /// Тонкая линия-разделитель внутри секции
    private func makeSeparator() -> NSView {
        let line = NSBox()
        line.boxType = .separator
        line.translatesAutoresizingMaskIntoConstraints = false
        line.heightAnchor.constraint(equalToConstant: 1).isActive = true
        return line
    }

}
extension SettingsSheet {
    /// Сохраняет порт и предлагает перезапустить прокси
    private func applyPort() {
        guard let port = Int(portField.stringValue.trimmingCharacters(in: .whitespaces)), (1...65535).contains(port) else {
            showAlert(L10n.t("Неверный порт"), L10n.t("Порт должен быть числом от 1 до 65535"))
            portField.stringValue = "\(ProxyPortSettings.current)"
            return
        }
        ProxyPortSettings.save(port)
        onPortChange?(port)
        let isRunning = runtime.controller?.state.status == .running
        guard isRunning else {
            showAlert(L10n.t("Порт сохранён"), String(format: L10n.t("Прокси запустится на порту %d"), port))
            return
        }
        let alert = NSAlert()
        alert.messageText = L10n.t("Порт сохранён")
        alert.informativeText = String(format: L10n.t("Перезапустить прокси на порту %d сейчас?"), port)
        alert.addButton(withTitle: L10n.t("Перезапустить"))
        alert.addButton(withTitle: L10n.t("Позже"))
        if alert.runModal() == .alertFirstButtonReturn {
            onRestart?()
        }
    }

    /// Переключает язык интерфейса
    @objc private func changeLanguage() {
        let languages = L10n.Language.allCases
        let index = languagePopup.indexOfSelectedItem
        guard index >= 0, index < languages.count else {
            return
        }
        L10n.save(languages[index])
        showAlert(L10n.t("Язык изменён"), L10n.t("Язык изменится после перезапуска приложения"))
    }

    /// Сохраняет область перехвата трафика
    private func applyScope() {
        let mode = TunnelScope.Mode(rawValue: scopePopup.indexOfSelectedItem) ?? .all
        let hosts = scopeField.stringValue
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
            .filter { !$0.isEmpty }
        TunnelScope.save(mode: mode, hosts: hosts)
        scopeField.stringValue = hosts.joined(separator: ", ")
        showAlert(L10n.t("Область перехвата сохранена"), mode == .all ? L10n.t("Прокси расшифровывает все хосты") : String(format: L10n.t("Список хостов: %d"), hosts.count))
    }

    /// Показывает состояние доверия к CA-сертификату
    private func refreshCertStatus() {
        certLabel.stringValue = L10n.t("проверка сертификата")
        Task { [weak self] in
            let status = await CertTrustDarwin.status()
            guard let self else {
                return
            }
            switch status {
            case .notGenerated:
                certLabel.stringValue = L10n.t("Сертификат прокси ещё не создан")
                certButton.title = L10n.t("Создать и доверять")
            case .notTrusted:
                certLabel.stringValue = L10n.t("Сертификат не доверен системе")
                certButton.title = L10n.t("Установить доверие")
            case .trusted:
                certLabel.stringValue = L10n.t("Сертификат доверен системе")
                certButton.title = L10n.t("Убрать доверие")
            }
            certButton.isHidden = false
        }
    }

    /// Ставит или снимает доверие к сертификату
    private func toggleCert() {
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
                showAlert(L10n.t("Не удалось изменить доверие"), error.localizedDescription)
            }
            refreshCertStatus()
            certButton.isEnabled = true
        }
    }

    /// Показывает состояние правила sudoers
    private func refreshSudoersStatus() {
        let installed = runtime.systemProxy.isPasswordlessSetup()
        sudoersLabel.stringValue = installed
            ? L10n.t("Беспарольное переключение системного прокси настроено")
            : L10n.t("Системный прокси переключается с запросом пароля")
        sudoersButton.title = installed ? L10n.t("Отозвать") : L10n.t("Установить")
    }

    /// Ставит или снимает правило sudoers
    private func toggleSudoers() {
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
                showAlert(L10n.t("Не удалось настроить sudoers"), error.localizedDescription)
            }
            refreshSudoersStatus()
            sudoersButton.isEnabled = true
        }
    }

}
extension SettingsSheet {
    /// Экспортирует правила в JSON-файл
    private func exportRules() {
        let rules = runtime.rulesStore.all()
        guard !rules.isEmpty else {
            showAlert(L10n.t("Нет правил"), L10n.t("В списке нет правил для экспорта"))
            return
        }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "file-switcher-rules.json"
        panel.allowedContentTypes = [.json]
        guard panel.runModal() == .OK, let url = panel.url else {
            return
        }
        do {
            try JsonFile.write(RulesFile(rules: rules), to: url)
            showAlert(L10n.t("Правила экспортированы"), url.path)
        } catch {
            showAlert(L10n.t("Не удалось сохранить файл"), error.localizedDescription)
        }
    }

    /// Заменяет правила содержимым выбранного JSON-файла
    private func importRules() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.json]
        guard panel.runModal() == .OK, let url = panel.url else {
            return
        }
        let imported: [Rule]
        do {
            let data = try Data(contentsOf: url)
            let decoder = JSONDecoder()
            if let file = try? decoder.decode(RulesFile.self, from: data) {
                imported = file.rules
            } else {
                imported = try decoder.decode([Rule].self, from: data)
            }
        } catch {
            showAlert(L10n.t("Неверный формат файла"), L10n.t("Ожидался JSON с массивом правил"))
            return
        }
        let alert = NSAlert()
        alert.messageText = L10n.t("Заменить правила?")
        alert.informativeText = String(format: L10n.t("Текущий список будет заменён правилами из файла (%d шт.)"), imported.count)
        alert.addButton(withTitle: L10n.t("Заменить"))
        alert.addButton(withTitle: L10n.t("Отмена"))
        guard alert.runModal() == .alertFirstButtonReturn else {
            return
        }
        do {
            _ = try runtime.rulesStore.saveAll(imported)
            onRulesChanged?()
            showAlert(L10n.t("Правила импортированы"), String(format: L10n.t("Загружено правил: %d"), imported.count))
        } catch {
            showAlert(L10n.t("Не удалось импортировать правила"), error.localizedDescription)
        }
    }

    /// Перечитывает правила с диска
    private func reloadRules() {
        onRulesChanged?()
        showAlert(L10n.t("Правила перечитаны"), String(format: L10n.t("Загружено правил: %d"), runtime.rulesStore.all().count))
    }

    /// Экспортирует журнал в выбранном формате
    private func exportLog() {
        let format = LogExportFormat.allCases[max(0, logFormatPopup.indexOfSelectedItem)]
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "file-switcher-log.\(format.rawValue)"
        panel.allowedContentTypes = [UTType(filenameExtension: format.rawValue) ?? .json]
        guard panel.runModal() == .OK, let url = panel.url else {
            return
        }
        do {
            try LogExport.stream(sourcePath: runtime.store.filePath, destinationPath: url.path, format: format)
            showAlert(L10n.t("Журнал экспортирован"), url.path)
        } catch {
            showAlert(L10n.t("Не удалось экспортировать журнал"), error.localizedDescription)
        }
    }

    /// Открывает папку с правилами и журналом в Finder
    private func openSupportFolder() {
        let directory = AppPaths.supportDirectory
        if !FileManager.default.fileExists(atPath: directory.path) {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        NSWorkspace.shared.open(directory)
    }

    /// Показывает файл текущей сессии журнала в Finder
    private func revealLogFile() {
        let path = runtime.store.filePath
        guard FileManager.default.fileExists(atPath: path) else {
            showAlert(L10n.t("Журнала пока нет"), L10n.t("В этой сессии ещё не записано ни одного запроса"))
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
    }

    /// Удаляет с диска файлы журнала всех сессий
    private func resetLogs() {
        let alert = NSAlert()
        alert.messageText = L10n.t("Удалить журналы?")
        alert.informativeText = L10n.t("Будут удалены файлы трафика всех сессий. Правила и настройки останутся.")
        alert.alertStyle = .warning
        alert.addButton(withTitle: L10n.t("Удалить"))
        alert.addButton(withTitle: L10n.t("Отмена"))
        guard alert.runModal() == .alertFirstButtonReturn else {
            return
        }
        let directory = AppPaths.trafficLogDirectory
        let manager = FileManager.default
        let names = (try? manager.contentsOfDirectory(atPath: directory.path)) ?? []
        var removed = 0
        for name in names where name.hasPrefix("traffic-") && name.hasSuffix(".jsonl") {
            let url = directory.appendingPathComponent(name)
            if (try? manager.removeItem(at: url)) != nil {
                removed += 1
            }
        }
        showAlert(L10n.t("Журналы удалены"), String(format: L10n.t("Удалено файлов: %d. Перезапустите приложение, чтобы начать новый журнал."), removed))
    }

    /// Показывает короткое модальное сообщение
    private func showAlert(_ title: String, _ text: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = text
        alert.addButton(withTitle: L10n.t("Ок"))
        alert.runModal()
    }
}
