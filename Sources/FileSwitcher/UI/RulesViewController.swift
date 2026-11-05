import AppKit

/// Панель правил подмены: список по группам, включение, правка и перенос между группами
@MainActor
final class RulesViewController: NSViewController {
    /// Строка списка: заголовок группы или правило
    private enum Row {
        case group(String)
        case rule(Rule)
    }

    private let runtime: AppRuntime
    private var rules: [Rule] = []
    private var rows: [Row] = []
    private let tableView = NSTableView()
    private let selectAllBox: NSButton = {
        let box = NSButton(checkboxWithTitle: "", target: nil, action: nil)
        box.allowsMixedState = true
        box.toolTip = "Включить или выключить все правила"
        box.translatesAutoresizingMaskIntoConstraints = false
        return box
    }()
    private let emptyLabel = makeLabel("Правил пока нет", font: AppTheme.baseFont, color: .secondaryLabelColor)

    init(runtime: AppRuntime) {
        self.runtime = runtime
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) не используется")
    }

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 520, height: 600))
        buildLayout()
        reloadRules()
    }

    /// Собирает шапку с чекбоксом всех правил и кнопкой добавления
    private func buildLayout() {
        selectAllBox.target = self
        selectAllBox.action = #selector(toggleAll)
        let addButton = makeIconButton(
            symbol: "plus",
            tooltip: "Добавить правило",
            target: self,
            action: #selector(createRule)
        )
        let headerRow = makeRow([selectAllBox, makeSpacer(), addButton], spacing: 8)
        headerRow.distribution = .fill

        tableView.headerView = nil
        tableView.style = .plain
        tableView.rowHeight = 34
        tableView.intercellSpacing = NSSize(width: 0, height: 0)
        tableView.usesAlternatingRowBackgroundColors = false
        tableView.allowsEmptySelection = true
        tableView.dataSource = self
        tableView.delegate = self
        tableView.target = self
        tableView.action = #selector(openSelectedRule)
        tableView.menu = makeContextMenu()
        tableView.registerForDraggedTypes([.string])
        tableView.setDraggingSourceOperationMask(.move, forLocal: true)
        tableView.draggingDestinationFeedbackStyle = .gap
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("rule"))
        column.resizingMask = .autoresizingMask
        tableView.addTableColumn(column)

        let scroll = NSScrollView()
        scroll.documentView = tableView
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        scroll.setContentHuggingPriority(.defaultLow, for: .vertical)

        emptyLabel.alignment = .center

        let container = NSView()
        container.addSubview(scroll)
        container.addSubview(emptyLabel)
        scroll.pinEdges(to: container)
        emptyLabel.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            emptyLabel.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            emptyLabel.centerYAnchor.constraint(equalTo: container.centerYAnchor)
        ])

        let columnStack = makeColumn([headerRow, container], spacing: 6)
        columnStack.alignment = .leading
        NSLayoutConstraint.activate([
            headerRow.widthAnchor.constraint(equalTo: columnStack.widthAnchor),
            container.widthAnchor.constraint(equalTo: columnStack.widthAnchor)
        ])
        container.setContentHuggingPriority(.defaultLow, for: .vertical)
        view.addSubview(columnStack)
        columnStack.pinEdges(to: view, insets: NSEdgeInsets(top: 8, left: 8, bottom: 8, right: 8))
    }

    /// Перечитывает правила из файла и перестраивает список
    func reloadRules() {
        rules = runtime.rulesStore.all()
        rebuildRows()
    }

    /// Открывает форму нового правила, заполненного из записи журнала
    func addRule(from event: ProxyLogEvent) {
        var draft = draftRule(from: event)
        if let firstRule = rules.first {
            let firstGroup = groupKey(of: firstRule)
            draft.group = firstGroup == otherGroupKey ? nil : firstGroup
        }
        presentForm(rule: nil, draft: draft)
    }

    /// Строит строки списка: именованные группы по алфавиту, «остальные» в конце
    private func rebuildRows() {
        var namedGroups: [String] = []
        for rule in rules {
            let key = groupKey(of: rule)
            if key != otherGroupKey, !namedGroups.contains(key) {
                namedGroups.append(key)
            }
        }
        namedGroups.sort(by: compareGroupNames)

        var result: [Row] = []
        for key in namedGroups {
            result.append(.group(key))
            result.append(contentsOf: rules.filter { groupKey(of: $0) == key }.map { Row.rule($0) })
        }
        let others = rules.filter { groupKey(of: $0) == otherGroupKey }
        if !others.isEmpty {
            result.append(.group(otherGroupKey))
            result.append(contentsOf: others.map { Row.rule($0) })
        }
        rows = result
        tableView.reloadData()
        updateHeader()
    }

    /// Обновляет чекбокс всех правил
    private func updateHeader() {
        let enabledCount = rules.filter(\.enabled).count
        if rules.isEmpty || enabledCount == 0 {
            selectAllBox.state = .off
        } else if enabledCount == rules.count {
            selectAllBox.state = .on
        } else {
            selectAllBox.state = .mixed
        }
        emptyLabel.isHidden = !rules.isEmpty
    }

    /// Сохраняет правила в файл и обновляет список
    private func saveRules(_ next: [Rule]) {
        do {
            rules = try runtime.rulesStore.saveAll(next)
            rebuildRows()
        } catch {
            showAlert("Правило не сохранено", error.localizedDescription)
        }
    }

    /// Включает или выключает все правила сразу
    @objc private func toggleAll() {
        let enableAll = selectAllBox.state != .on
        var next = rules
        for index in next.indices {
            next[index].enabled = enableAll
        }
        saveRules(next)
    }

    /// Открывает форму правила под курсором
    @objc private func openSelectedRule() {
        let row = tableView.clickedRow >= 0 ? tableView.clickedRow : tableView.selectedRow
        guard let rule = rule(at: row) else {
            return
        }
        presentForm(rule: rule, draft: nil)
    }

    /// Открывает форму нового правила
    @objc private func createRule() {
        var draft = Rule(id: UUID().uuidString, enabled: true, urlPattern: "", isRegex: false)
        if let firstRule = rules.first {
            let firstGroup = groupKey(of: firstRule)
            draft.group = firstGroup == otherGroupKey ? nil : firstGroup
        }
        presentForm(rule: nil, draft: draft)
    }

    /// Показывает модальную форму создания или правки правила
    private func presentForm(rule: Rule?, draft: Rule?) {
        let sheet = RuleFormSheet(rule: rule, draft: draft, groups: knownGroups())
        sheet.onSave = { [weak self] saved in
            self?.upsert(saved, isNew: rule == nil)
        }
        sheet.onDelete = { [weak self] deleted in
            self?.deleteRule(id: deleted.id)
        }
        sheet.onDuplicate = { [weak self] source in
            self?.duplicateRule(source)
        }
        presentAsSheet(sheet)
    }

    /// Добавляет новое правило или обновляет существующее
    private func upsert(_ rule: Rule, isNew: Bool) {
        var next = rules
        if let index = next.firstIndex(where: { $0.id == rule.id }) {
            next[index] = rule
        } else {
            next.append(rule)
        }
        if isNew {
            next = next.filter { $0.id != rule.id } + [rule]
        }
        saveRules(next)
    }

    /// Удаляет правило по идентификатору
    private func deleteRule(id: String) {
        saveRules(rules.filter { $0.id != id })
    }

    /// Создаёт копию правила в той же группе
    private func duplicateRule(_ source: Rule) {
        var copy = source
        copy.id = UUID().uuidString
        saveRules(rules + [copy])
    }

    /// Переносит правило в другую группу
    private func moveRule(id: String, to group: String) {
        var next = rules
        guard let index = next.firstIndex(where: { $0.id == id }) else {
            return
        }
        next[index].group = group.isEmpty ? nil : group
        saveRules(next)
    }

    /// Список групп, которые уже есть в правилах
    private func knownGroups() -> [String] {
        var groups: [String] = []
        for rule in rules {
            let key = groupKey(of: rule)
            if key != otherGroupKey, !groups.contains(key) {
                groups.append(key)
            }
        }
        return groups.sorted(by: compareGroupNames)
    }

    /// Правило в указанной строке списка
    private func rule(at row: Int) -> Rule? {
        guard row >= 0, row < rows.count, case let .rule(rule) = rows[row] else {
            return nil
        }
        return rule
    }

    /// Показывает модальное сообщение
    private func showAlert(_ title: String, _ text: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = text
        alert.alertStyle = .warning
        alert.runModal()
    }
}


extension RulesViewController: NSTableViewDataSource, NSTableViewDelegate {
    func numberOfRows(in tableView: NSTableView) -> Int {
        rows.count
    }

    func tableView(_ tableView: NSTableView, heightOfRow row: Int) -> CGFloat {
        guard row < rows.count, case .rule = rows[row] else {
            return 24
        }
        return 34
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        guard row < rows.count else {
            return nil
        }
        switch rows[row] {
        case let .group(key):
            let identifier = NSUserInterfaceItemIdentifier("rule-group")
            let cell = tableView.makeView(withIdentifier: identifier, owner: self) as? RuleGroupCellView
                ?? RuleGroupCellView(identifier: identifier)
            cell.apply(key: key)
            return cell
        case let .rule(rule):
            let identifier = NSUserInterfaceItemIdentifier("rule-cell")
            let cell = tableView.makeView(withIdentifier: identifier, owner: self) as? RuleCellView
                ?? RuleCellView(identifier: identifier)
            cell.apply(rule: rule)
            cell.onToggle = { [weak self] isOn in
                self?.setEnabled(isOn, ruleId: rule.id)
            }
            return cell
        }
    }

    func tableView(_ tableView: NSTableView, rowViewForRow row: Int) -> NSTableRowView? {
        let rowView = RuleRowView()
        guard row < rows.count, case let .rule(rule) = rows[row] else {
            return rowView
        }
        if let body = rule.responseBody, !body.isEmpty {
            rowView.fillColor = AppTheme.bodyRow
        } else if let path = rule.localFilePath, !path.isEmpty {
            rowView.fillColor = AppTheme.fileRow
        }
        return rowView
    }

    func tableView(_ tableView: NSTableView, pasteboardWriterForRow row: Int) -> NSPasteboardWriting? {
        guard row < rows.count, case let .rule(rule) = rows[row] else {
            return nil
        }
        return rule.id as NSString
    }

    func tableView(
        _ tableView: NSTableView,
        validateDrop info: NSDraggingInfo,
        proposedRow row: Int,
        proposedDropOperation dropOperation: NSTableView.DropOperation
    ) -> NSDragOperation {
        guard dropOperation == .on else {
            return []
        }
        return .move
    }

    func tableView(
        _ tableView: NSTableView,
        acceptDrop info: NSDraggingInfo,
        row: Int,
        dropOperation: NSTableView.DropOperation
    ) -> Bool {
        guard let id = info.draggingPasteboard.string(forType: .string), row >= 0, row < rows.count else {
            return false
        }
        switch rows[row] {
        case let .group(key):
            moveRule(id: id, to: key)
        case let .rule(rule):
            moveRule(id: id, to: groupKey(of: rule))
        }
        return true
    }
}

extension RulesViewController: NSMenuDelegate {
    func menuNeedsUpdate(_ menu: NSMenu) {
        let row = tableView.clickedRow
        let isRuleRow = rule(at: row) != nil
        for item in menu.items where item.action != nil {
            item.isEnabled = isRuleRow
        }
    }
}


extension RulesViewController {
    /// Включает или выключает одно правило
    func setEnabled(_ enabled: Bool, ruleId: String) {
        var next = rules
        guard let index = next.firstIndex(where: { $0.id == ruleId }) else {
            return
        }
        next[index].enabled = enabled
        saveRules(next)
    }

    /// Меню правого клика по строке правила
    func makeContextMenu() -> NSMenu {
        let menu = NSMenu()
        menu.delegate = self
        menu.addItem(withTitle: "Изменить", action: #selector(editRow), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Дублировать", action: #selector(duplicateRow), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Переместить в группу…", action: #selector(moveRowToGroup), keyEquivalent: "")
            .target = self
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "Удалить", action: #selector(deleteRow), keyEquivalent: "").target = self
        return menu
    }

    /// Открывает форму правила из контекстного меню
    @objc private func editRow() {
        guard let rule = rule(at: tableView.clickedRow) else {
            return
        }
        presentForm(rule: rule, draft: nil)
    }

    /// Дублирует правило из контекстного меню
    @objc private func duplicateRow() {
        guard let rule = rule(at: tableView.clickedRow) else {
            return
        }
        duplicateRule(rule)
    }

    /// Удаляет правило после подтверждения
    @objc private func deleteRow() {
        guard let rule = rule(at: tableView.clickedRow) else {
            return
        }
        let alert = NSAlert()
        alert.messageText = "Удалить правило?"
        alert.informativeText = rule.urlPattern
        alert.addButton(withTitle: "Удалить")
        alert.addButton(withTitle: "Отмена")
        guard alert.runModal() == .alertFirstButtonReturn else {
            return
        }
        deleteRule(id: rule.id)
    }

    /// Спрашивает группу и переносит в неё правило
    @objc private func moveRowToGroup() {
        guard let rule = rule(at: tableView.clickedRow) else {
            return
        }
        let groups = knownGroups() + [otherGroupKey]
        let popup = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 240, height: 26), pullsDown: false)
        for group in groups {
            popup.addItem(withTitle: group.isEmpty ? "остальные" : group)
        }
        if let index = groups.firstIndex(of: groupKey(of: rule)) {
            popup.selectItem(at: index)
        }
        let alert = NSAlert()
        alert.messageText = "Переместить правило"
        alert.informativeText = "Выберите группу для правила"
        alert.accessoryView = popup
        alert.addButton(withTitle: "Переместить")
        alert.addButton(withTitle: "Отмена")
        guard alert.runModal() == .alertFirstButtonReturn, popup.indexOfSelectedItem >= 0 else {
            return
        }
        moveRule(id: rule.id, to: groups[popup.indexOfSelectedItem])
    }
}


/// Заголовок группы правил в списке
@MainActor
final class RuleGroupCellView: NSView {
    private let label = makeLabel("", font: AppTheme.groupFont, color: .secondaryLabelColor)

    init(identifier: NSUserInterfaceItemIdentifier) {
        super.init(frame: .zero)
        self.identifier = identifier
        addSubview(label)
        label.pinEdges(to: self, insets: NSEdgeInsets(top: 6, left: 6, bottom: 0, right: 6))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) не используется")
    }

    /// Показывает название группы
    func apply(key: String) {
        let name = key.isEmpty ? "остальные" : key
        label.stringValue = name.uppercased()
    }
}

/// Строка правила: чекбокс включения, URL-паттерн и вторая строка с деталями подмены
@MainActor
final class RuleCellView: NSView {
    private let checkbox = NSButton(checkboxWithTitle: "", target: nil, action: nil)
    private let urlLabel = makeLabel("", font: AppTheme.compactBoldFont)
    private let detailLabel = makeLabel("", font: AppTheme.compactFont, color: .secondaryLabelColor)
    /// Переключили включение правила
    var onToggle: ((Bool) -> Void)?

    init(identifier: NSUserInterfaceItemIdentifier) {
        super.init(frame: .zero)
        self.identifier = identifier
        checkbox.target = self
        checkbox.action = #selector(toggle)
        checkbox.translatesAutoresizingMaskIntoConstraints = false

        urlLabel.lineBreakMode = .byTruncatingTail
        detailLabel.lineBreakMode = .byTruncatingMiddle
        let textColumn = makeColumn([urlLabel, detailLabel], spacing: 0)
        textColumn.alignment = .leading

        addSubview(checkbox)
        addSubview(textColumn)
        NSLayoutConstraint.activate([
            checkbox.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 6),
            checkbox.centerYAnchor.constraint(equalTo: centerYAnchor),
            checkbox.widthAnchor.constraint(equalToConstant: 18),
            textColumn.leadingAnchor.constraint(equalTo: checkbox.trailingAnchor, constant: 6),
            textColumn.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -6),
            textColumn.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) не используется")
    }

    /// Заполняет строку данными правила
    func apply(rule: Rule) {
        checkbox.state = rule.enabled ? .on : .off
        urlLabel.stringValue = rule.urlPattern
        urlLabel.textColor = rule.enabled ? .labelColor : .secondaryLabelColor
        detailLabel.stringValue = detailText(rule)
        toolTip = rule.localFilePath
    }

    /// Вторая строка правила: файл подмены, тело в правиле или пометка об отсутствии подмены
    private func detailText(_ rule: Rule) -> String {
        if let body = rule.responseBody, !body.isEmpty {
            return "тело в правиле, \(MetaFormat.size(body.utf8.count))"
        }
        if let path = rule.localFilePath, !path.isEmpty {
            return MetaFormat.stripHome(path)
        }
        return "без подмены"
    }

    @objc private func toggle() {
        onToggle?(checkbox.state == .on)
    }
}

/// Строка списка с фоном по типу подмены правила
@MainActor
final class RuleRowView: NSTableRowView {
    var fillColor: NSColor?

    override func drawBackground(in dirtyRect: NSRect) {
        guard let fillColor else {
            super.drawBackground(in: dirtyRect)
            return
        }
        fillColor.setFill()
        dirtyRect.fill()
    }
}


