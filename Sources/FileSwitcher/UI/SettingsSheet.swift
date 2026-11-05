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
    private let certLabel = makeLabel("проверка сертификата", font: AppTheme.compactFont, color: .secondaryLabelColor)
    private let sudoersLabel = makeLabel("проверка настройки", font: AppTheme.compactFont, color: .secondaryLabelColor)
    private let logFormatPopup = NSPopUpButton(frame: .zero, pullsDown: false)

    private lazy var certButton = ClosureButton(title: "Установить доверие") { [weak self] in
        self?.toggleCert()
    }

    private lazy var sudoersButton = ClosureButton(title: "Установить") { [weak self] in
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
        let title = makeLabel("Настройки", font: NSFont.systemFont(ofSize: 15, weight: .semibold))
        let doneButton = ClosureButton(title: "Готово") { [weak self] in
            self?.dismiss(nil)
        }
        doneButton.keyEquivalent = "\r"
        let header = makeRow([title, makeSpacer(), doneButton], spacing: 8)
        header.distribution = .fill

        portField.translatesAutoresizingMaskIntoConstraints = false
        portField.alignment = .right
        portField.widthAnchor.constraint(equalToConstant: 90).isActive = true

        let applyPortButton = ClosureButton(title: "Применить") { [weak self] in
            self?.applyPort()
        }
        let portRow = makeRow([makeLabel("Порт прокси", font: AppTheme.baseFont), portField, applyPortButton], spacing: 8)

        certButton.toolTip = "Firefox использует своё хранилище сертификатов: CA придётся добавить вручную"

        let exportRulesButton = ClosureButton(title: "Экспорт") { [weak self] in
            self?.exportRules()
        }
        let importRulesButton = ClosureButton(title: "Импорт") { [weak self] in
            self?.importRules()
        }
        let refreshRulesButton = ClosureButton(title: "Перезагрузить") { [weak self] in
            self?.reloadRules()
        }
        let rulesRow = makeRow([exportRulesButton, importRulesButton, refreshRulesButton], spacing: 8)

        logFormatPopup.translatesAutoresizingMaskIntoConstraints = false
        for format in LogExportFormat.allCases {
            logFormatPopup.addItem(withTitle: format.rawValue.uppercased())
        }
        let exportLogButton = ClosureButton(title: "Экспорт") { [weak self] in
            self?.exportLog()
        }
        let logRow = makeRow([logFormatPopup, exportLogButton], spacing: 8)

        let openFolderButton = ClosureButton(title: "Открыть папку данных") { [weak self] in
            self?.openSupportFolder()
        }
        let folderLabel = makeLabel(
            MetaFormat.stripHome(AppPaths.supportDirectory.path),
            font: AppTheme.monoFont,
            color: .secondaryLabelColor
        )

        let sections: [NSView] = [
            header,
            makeSection("Сеть и сертификат", views: [
                portRow,
                makeSeparator(),
                certLabel, certButton,
                makeSeparator(),
                sudoersLabel, sudoersButton
            ]),
            makeSection("Правила", views: [rulesRow]),
            makeSection("Журнал", views: [logRow]),
            makeSection("Данные", views: [folderLabel, openFolderButton])
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
            showAlert("Неверный порт", "Порт должен быть числом от 1 до 65535")
            portField.stringValue = "\(ProxyPortSettings.current)"
            return
        }
        ProxyPortSettings.save(port)
        onPortChange?(port)
        let isRunning = runtime.controller?.state.status == .running
        guard isRunning else {
            showAlert("Порт сохранён", "Прокси запустится на порту \(port)")
            return
        }
        let alert = NSAlert()
        alert.messageText = "Порт сохранён"
        alert.informativeText = "Перезапустить прокси на порту \(port) сейчас?"
        alert.addButton(withTitle: "Перезапустить")
        alert.addButton(withTitle: "Позже")
        if alert.runModal() == .alertFirstButtonReturn {
            onRestart?()
        }
    }

    /// Показывает состояние доверия к CA-сертификату
    private func refreshCertStatus() {
        certLabel.stringValue = "проверка сертификата"
        Task { [weak self] in
            let status = await CertTrustDarwin.status()
            guard let self else {
                return
            }
            switch status {
            case .notGenerated:
                certLabel.stringValue = "Сертификат прокси ещё не создан"
                certButton.title = "Создать и доверять"
            case .notTrusted:
                certLabel.stringValue = "Сертификат не доверен системе"
                certButton.title = "Установить доверие"
            case .trusted:
                certLabel.stringValue = "Сертификат доверен системе"
                certButton.title = "Убрать доверие"
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
                showAlert("Не удалось изменить доверие", error.localizedDescription)
            }
            refreshCertStatus()
            certButton.isEnabled = true
        }
    }

    /// Показывает состояние правила sudoers
    private func refreshSudoersStatus() {
        let installed = runtime.systemProxy.isPasswordlessSetup()
        sudoersLabel.stringValue = installed
            ? "Беспарольное переключение системного прокси настроено"
            : "Системный прокси переключается с запросом пароля"
        sudoersButton.title = installed ? "Отозвать" : "Установить"
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
                showAlert("Не удалось настроить sudoers", error.localizedDescription)
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
            showAlert("Нет правил", "В списке нет правил для экспорта")
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
            showAlert("Правила экспортированы", url.path)
        } catch {
            showAlert("Не удалось сохранить файл", error.localizedDescription)
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
            showAlert("Неверный формат файла", "Ожидался JSON с массивом правил")
            return
        }
        let alert = NSAlert()
        alert.messageText = "Заменить правила?"
        alert.informativeText = "Текущий список будет заменён правилами из файла (\(imported.count) шт.)"
        alert.addButton(withTitle: "Заменить")
        alert.addButton(withTitle: "Отмена")
        guard alert.runModal() == .alertFirstButtonReturn else {
            return
        }
        do {
            _ = try runtime.rulesStore.saveAll(imported)
            onRulesChanged?()
            showAlert("Правила импортированы", "Загружено правил: \(imported.count)")
        } catch {
            showAlert("Не удалось импортировать правила", error.localizedDescription)
        }
    }

    /// Перечитывает правила с диска
    private func reloadRules() {
        onRulesChanged?()
        showAlert("Правила перечитаны", "Загружено правил: \(runtime.rulesStore.all().count)")
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
            showAlert("Журнал экспортирован", url.path)
        } catch {
            showAlert("Не удалось экспортировать журнал", error.localizedDescription)
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

    /// Показывает короткое модальное сообщение
    private func showAlert(_ title: String, _ text: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = text
        alert.addButton(withTitle: "Ок")
        alert.runModal()
    }
}
