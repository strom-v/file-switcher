import AppKit

/// Вкладка правил: список, включение и редактирование правил подмены
@MainActor
final class RulesViewController: NSViewController {
    private let runtime: AppRuntime
    private var rules: [Rule] = []

    private let tableView = NSTableView()
    private let patternField = NSTextField()
    private let groupField = NSTextField()
    private let filePathField = NSTextField()
    private let isRegexBox = NSButton(checkboxWithTitle: "regex", target: nil, action: nil)
    private let statusField = NSTextField(string: "")
    private let delayField = NSTextField(string: "")
    private let errorLabel = NSTextField(labelWithString: "")
    private let bodyView = NSTextView()

    init(runtime: AppRuntime) {
        self.runtime = runtime
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) не используется")
    }

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 940, height: 560))
        buildLayout()
        reload()
    }

    /// Собирает таблицу правил и форму выбранного правила
    private func buildLayout() {
        guard let view = view as NSView? else {
            return
        }
        tableView.usesAlternatingRowBackgroundColors = true
        tableView.dataSource = self
        tableView.delegate = self
        for (title, width) in [("вкл", 40.0), ("паттерн", 320.0), ("группа", 120.0), ("подмена", 240.0)] {
            let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier(title))
            column.title = title
            column.width = width
            tableView.addTableColumn(column)
        }
        let scroll = NSScrollView()
        scroll.documentView = tableView
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 240).isActive = true

        let addButton = NSButton(title: "Добавить", target: self, action: #selector(addRule))
        let removeButton = NSButton(title: "Удалить", target: self, action: #selector(removeRule))
        let toggleButton = NSButton(title: "Вкл/выкл", target: self, action: #selector(toggleRule))
        let saveButton = NSButton(title: "Сохранить изменения", target: self, action: #selector(saveEditedRule))
        let openButton = NSButton(title: "Открыть rules.json", target: self, action: #selector(openRulesFile))
        let buttons = NSStackView(views: [addButton, removeButton, toggleButton, saveButton, openButton])
        buttons.orientation = .horizontal
        buttons.spacing = 8

        patternField.placeholderString = "URL или regex"
        groupField.placeholderString = "группа"
        filePathField.placeholderString = "путь к файлу подмены (пусто - только модификации)"
        delayField.placeholderString = "delayMs"
        statusField.placeholderString = "statusCodeOverride"
        isRegexBox.target = self
        isRegexBox.action = #selector(syncSelectionToForm)

        let formRow = NSStackView(views: [isRegexBox, patternField, groupField])
        formRow.orientation = .horizontal
        formRow.spacing = 8
        let pathRow = NSStackView(views: [filePathField, delayField, statusField])
        pathRow.orientation = .horizontal
        pathRow.spacing = 8

        bodyView.isEditable = true
        bodyView.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        let bodyScroll = NSScrollView()
        bodyScroll.documentView = bodyView
        bodyScroll.hasVerticalScroller = true
        bodyScroll.borderType = .bezelBorder
        bodyScroll.heightAnchor.constraint(equalToConstant: 110).isActive = true

        errorLabel.textColor = .systemRed
        errorLabel.maximumNumberOfLines = 2

        let stack = NSStackView(views: [buttons, scroll, formRow, pathRow, NSTextField(labelWithString: "тело ответа (inline):"), bodyScroll, errorLabel])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 10),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -10),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 10),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -10),
            scroll.widthAnchor.constraint(equalTo: stack.widthAnchor),
            formRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            pathRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            bodyScroll.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
    }

    /// Перечитывает правила из файла
    private func reload() {
        rules = runtime.rulesStore.all()
        tableView.reloadData()
        errorLabel.stringValue = ""
    }

    /// Заполняет форму выбранным правилом
    @objc private func syncSelectionToForm() {
        let row = tableView.selectedRow
        guard row >= 0, row < rules.count else {
            return
        }
        let rule = rules[row]
        patternField.stringValue = rule.urlPattern
        groupField.stringValue = rule.group ?? ""
        filePathField.stringValue = rule.localFilePath ?? ""
        isRegexBox.state = rule.isRegex ? .on : .off
        delayField.stringValue = rule.delayMs.map(String.init) ?? ""
        statusField.stringValue = rule.statusCodeOverride.map(String.init) ?? ""
        bodyView.string = rule.responseBody ?? ""
    }

    /// Добавляет пустое правило и сразу сохраняет файл
    @objc private func addRule() {
        var rule = Rule(id: UUID().uuidString, enabled: true, urlPattern: "", isRegex: true)
        rule.group = otherGroupKey
        rules.append(rule)
        saveRules()
        tableView.reloadData()
        tableView.selectRowIndexes(IndexSet(integer: rules.count - 1), byExtendingSelection: false)
        syncSelectionToForm()
    }

    /// Удаляет выбранное правило
    @objc private func removeRule() {
        let row = tableView.selectedRow
        guard row >= 0, row < rules.count else {
            return
        }
        rules.remove(at: row)
        saveRules()
        tableView.reloadData()
    }

    /// Включает или выключает выбранное правило
    @objc private func toggleRule() {
        let row = tableView.selectedRow
        guard row >= 0, row < rules.count else {
            return
        }
        rules[row].enabled.toggle()
        saveRules()
        tableView.reloadData()
    }

    /// Переносит содержимое формы в выбранное правило и сохраняет
    @objc private func saveEditedRule() {
        let row = tableView.selectedRow
        guard row >= 0, row < rules.count else {
            errorLabel.stringValue = "выберите правило"
            return
        }
        var rule = rules[row]
        rule.urlPattern = patternField.stringValue
        rule.isRegex = isRegexBox.state == .on
        let group = groupField.stringValue
        rule.group = group.isEmpty ? otherGroupKey : group
        let filePath = filePathField.stringValue.trimmingCharacters(in: .whitespaces)
        rule.localFilePath = filePath.isEmpty ? nil : filePath
        rule.delayMs = Int(delayField.stringValue)
        rule.statusCodeOverride = Int(statusField.stringValue)
        let body = bodyView.string
        rule.responseBody = body.isEmpty ? nil : body
        rules[row] = rule
        saveRules()
        tableView.reloadData()
    }

    /// Открывает rules.json в редакторе по умолчанию
    @objc private func openRulesFile() {
        NSWorkspace.shared.open(URL(fileURLWithPath: runtime.rulesStore.filePath))
    }

    /// Сохраняет набор правил и показывает ошибку валидации
    private func saveRules() {
        do {
            rules = try runtime.rulesStore.saveAll(rules)
            errorLabel.stringValue = ""
        } catch {
            errorLabel.stringValue = error.localizedDescription
        }
    }
}

/// Таблица правил
extension RulesViewController: NSTableViewDataSource, NSTableViewDelegate {
    func numberOfRows(in tableView: NSTableView) -> Int {
        rules.count
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        guard let column = tableColumn, row < rules.count else {
            return nil
        }
        let rule = rules[row]
        let text: String = switch column.identifier.rawValue {
        case "вкл": rule.enabled ? "✓" : ""
        case "паттерн": rule.urlPattern
        case "группа": rule.group ?? ""
        default: rule.responseBody != nil ? "тело в правиле" : (rule.localFilePath ?? "")
        }
        let cell = NSTextField(labelWithString: text)
        cell.lineBreakMode = .byTruncatingMiddle
        cell.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        return cell
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        syncSelectionToForm()
    }
}
