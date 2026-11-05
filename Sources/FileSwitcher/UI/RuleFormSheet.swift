import AppKit

/// Форма создания и правки правила подмены
@MainActor
final class RuleFormSheet: NSViewController {
    private var draft: Rule
    private let groups: [String]
    private let isNew: Bool

    /// Сохранить правило
    var onSave: ((Rule) -> Void)?
    /// Удалить правило
    var onDelete: ((Rule) -> Void)?
    /// Создать копию правила
    var onDuplicate: ((Rule) -> Void)?

    private let urlField = NSTextField()
    private let groupBox = NSComboBox()
    private let pathField = NSTextField()
    private let bodyView = NSTextView()
    private let regexBox = NSButton(checkboxWithTitle: "Regex", target: nil, action: nil)
    private let contentTypeField = NSTextField()
    private let delayField = NSTextField()
    private let statusField = NSTextField()

    init(rule: Rule?, draft: Rule?, groups: [String]) {
        let initial = rule ?? draft ?? Rule(id: UUID().uuidString, enabled: true, urlPattern: "", isRegex: false)
        self.draft = initial
        self.groups = groups
        self.isNew = rule == nil
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) не используется")
    }

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 660, height: 600))
        buildLayout()
        fillFields()
    }

    /// Собирает поля правила и нижние кнопки
    private func buildLayout() {
        urlField.font = AppTheme.monoFont
        urlField.placeholderString = #"/api/orders или ^https://example\.com/.*$"#
        urlField.translatesAutoresizingMaskIntoConstraints = false

        groupBox.removeAllItems()
        groupBox.addItems(withObjectValues: groups)
        groupBox.completes = false
        groupBox.font = AppTheme.compactFont

        pathField.font = AppTheme.monoFont
        pathField.placeholderString = "путь к файлу на диске"
        let chooseButton = ClosureButton(title: "Выбрать…") { [weak self] in
            self?.chooseFile()
        }
        let pathRow = makeRow([pathField, chooseButton], spacing: 6)
        pathRow.distribution = .fill

        bodyView.isRichText = false
        bodyView.font = AppTheme.monoFont
        bodyView.textContainerInset = NSSize(width: 6, height: 6)
        bodyView.isHorizontallyResizable = false
        bodyView.textContainer?.widthTracksTextView = true
        bodyView.autoresizingMask = [.width]
        let bodyScroll = NSScrollView()
        bodyScroll.documentView = bodyView
        bodyScroll.hasVerticalScroller = true
        bodyScroll.autohidesScrollers = true
        bodyScroll.borderType = .bezelBorder
        bodyScroll.heightAnchor.constraint(equalToConstant: 170).isActive = true

        regexBox.translatesAutoresizingMaskIntoConstraints = false
        contentTypeField.placeholderString = "content-type ответа"
        contentTypeField.font = AppTheme.compactFont
        delayField.placeholderString = "задержка, мс"
        delayField.font = AppTheme.compactFont
        statusField.placeholderString = "статус"
        statusField.font = AppTheme.compactFont
        NSLayoutConstraint.activate([
            contentTypeField.widthAnchor.constraint(equalToConstant: 200),
            delayField.widthAnchor.constraint(equalToConstant: 110),
            statusField.widthAnchor.constraint(equalToConstant: 80)
        ])
        let extrasRow = makeRow([regexBox, contentTypeField, delayField, statusField, makeSpacer()], spacing: 8)
        extrasRow.distribution = .fill

        let form = makeColumn(
            [
                makeFieldGroup(title: "URL-паттерн", view: urlField),
                makeFieldGroup(title: "Группа", view: groupBox),
                makeFieldGroup(title: "Файл подмены", view: pathRow),
                makeFieldGroup(title: "Тело ответа", view: bodyScroll),
                makeFieldGroup(title: "Дополнительно", view: extrasRow)
            ],
            spacing: 10
        )
        form.alignment = .leading
        for group in form.arrangedSubviews {
            group.widthAnchor.constraint(equalTo: form.widthAnchor).isActive = true
        }

        let cancelButton = ClosureButton(title: "Отмена") { [weak self] in
            self?.dismiss(nil)
        }
        cancelButton.keyEquivalent = "\u{1b}"
        let saveButton = ClosureButton(title: "Сохранить") { [weak self] in
            self?.save()
        }
        saveButton.keyEquivalent = "\r"
        var leadingButtons: [NSView] = []
        if !isNew {
            let deleteButton = ClosureButton(title: "Удалить") { [weak self] in
                self?.deleteRule()
            }
            let duplicateButton = ClosureButton(title: "Дублировать") { [weak self] in
                self?.duplicateRule()
            }
            leadingButtons = [deleteButton, duplicateButton]
        }
        let bottomRow = makeRow(leadingButtons + [makeSpacer(), cancelButton, saveButton], spacing: 8)
        bottomRow.distribution = .fill

        let column = makeColumn([form, bottomRow], spacing: 10)
        column.alignment = .leading
        NSLayoutConstraint.activate([
            form.widthAnchor.constraint(equalTo: column.widthAnchor),
            bottomRow.widthAnchor.constraint(equalTo: column.widthAnchor)
        ])
        view.addSubview(column)
        column.pinEdges(to: view, insets: NSEdgeInsets(top: 14, left: 16, bottom: 14, right: 16))
    }

    /// Подпись поля вместе с контролом
    private func makeFieldGroup(title: String, view control: NSView) -> NSView {
        let label = makeLabel(title, font: AppTheme.compactFont, color: .secondaryLabelColor)
        let group = makeColumn([label, control], spacing: 3)
        group.alignment = .leading
        control.widthAnchor.constraint(equalTo: group.widthAnchor).isActive = true
        return group
    }


    /// Заполняет поля текущими значениями правила
    private func fillFields() {
        urlField.stringValue = draft.urlPattern
        if let group = draft.group, !group.isEmpty {
            groupBox.stringValue = group
        }
        pathField.stringValue = draft.localFilePath ?? ""
        bodyView.string = draft.responseBody ?? ""
        regexBox.state = draft.isRegex ? .on : .off
        contentTypeField.stringValue = draft.contentType ?? ""
        delayField.stringValue = draft.delayMs.map(String.init) ?? ""
        statusField.stringValue = draft.statusCodeOverride.map(String.init) ?? ""
    }

    /// Просит файл подмены на диске
    private func chooseFile() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else {
            return
        }
        pathField.stringValue = url.path
    }

    /// Проверяет поля и передаёт правило в список
    private func save() {
        draft.urlPattern = urlField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        draft.group = emptyToNil(groupBox.stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
        draft.localFilePath = emptyToNil(pathField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
        draft.responseBody = emptyToNil(bodyView.string)
        draft.isRegex = regexBox.state == .on
        draft.contentType = emptyToNil(contentTypeField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
        draft.delayMs = Int(delayField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
        draft.statusCodeOverride = Int(statusField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
        do {
            try validateRule(draft)
        } catch {
            showValidation(error.localizedDescription)
            return
        }
        dismiss(nil)
        onSave?(draft)
    }

    /// Удаляет правило после подтверждения
    private func deleteRule() {
        let alert = NSAlert()
        alert.messageText = "Удалить правило?"
        alert.informativeText = draft.urlPattern
        alert.addButton(withTitle: "Удалить")
        alert.addButton(withTitle: "Отмена")
        guard alert.runModal() == .alertFirstButtonReturn else {
            return
        }
        dismiss(nil)
        onDelete?(draft)
    }

    /// Создаёт копию правила и закрывает форму
    private func duplicateRule() {
        dismiss(nil)
        onDuplicate?(draft)
    }

    /// Показывает ошибку валидации, не закрывая форму
    private func showValidation(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Правило не сохранено"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.runModal()
    }

    /// Пустую строку превращает в nil, чтобы в файле не было пустых полей
    private func emptyToNil(_ value: String) -> String? {
        value.isEmpty ? nil : value
    }
}
