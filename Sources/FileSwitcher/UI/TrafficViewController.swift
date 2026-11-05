import AppKit
import UniformTypeIdentifiers

/// Панель журнала: поиск, фильтр событий, список запросов и детали выбранной записи
@MainActor
final class TrafficViewController: NSViewController {
    /// Фильтр списка по типу события
    private enum EventFilter: Int {
        case all
        case matched
    }

    private let runtime: AppRuntime
    private var entries: [LogEntryMeta] = []
    private var visible: [LogEntryMeta] = []
    /// Потолок строк, которые держим в памяти; файл журнала на диске хранит всё
    private static let maxEntries = 2000
    /// Сколько подмен среди строк в памяти
    private var matchedTotal = 0
    /// Запись новых строк журнала приостановлена
    private var isPaused = false
    /// Показывать только ответы со статусом 4xx-5xx
    private var onlyErrors = false
    /// ts записей, найденных поиском по телам; nil - поиск по телам не активен
    private var bodyMatches: Set<Double>?
    private var bodySearchTask: Task<Void, Never>?

    private let searchField = NSSearchField()
    private let bodySearchButton = NSButton()
    private let filterControl = NSSegmentedControl(
        labels: ["Все", "Подмены"],
        trackingMode: .selectOne,
        target: nil,
        action: nil
    )
    private let countLabel = makeLabel("", font: AppTheme.compactFont, color: .tertiaryLabelColor)
    private let tableView = NSTableView()
    /// Меню действий с журналом под кнопкой «…»
    private let actionsMenu = NSMenu()
    private let emptyLabel = makeLabel("", font: AppTheme.baseFont, color: .secondaryLabelColor)

    /// Создать черновик правила из записи журнала
    var onCreateRule: ((ProxyLogEvent) -> Void)?
    /// Показать предупреждение прокси в главном окне
    var onWarning: ((String) -> Void)?

    init(runtime: AppRuntime) {
        self.runtime = runtime
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) не используется")
    }

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 540, height: 600))
        buildLayout()
        bindRuntime()
    }

    /// Собирает тулбар поиска, счётчики и список журнала
    private func buildLayout() {
        searchField.placeholderString = "Поиск по URL или файлу подмены"
        searchField.translatesAutoresizingMaskIntoConstraints = false
        searchField.target = self
        searchField.action = #selector(applySearch)
        searchField.sendsWholeSearchString = false

        bodySearchButton.image = AppTheme.symbol("doc.text.magnifyingglass")
        bodySearchButton.imagePosition = .imageOnly
        bodySearchButton.isBordered = false
        bodySearchButton.bezelStyle = .regularSquare
        bodySearchButton.setButtonType(.toggle)
        bodySearchButton.toolTip = "Искать и в телах запросов"
        bodySearchButton.target = self
        bodySearchButton.action = #selector(applySearch)
        bodySearchButton.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            bodySearchButton.widthAnchor.constraint(equalToConstant: 24),
            bodySearchButton.heightAnchor.constraint(equalToConstant: 22)
        ])

        filterControl.selectedSegment = 0
        filterControl.target = self
        filterControl.action = #selector(applySearch)
        filterControl.setContentHuggingPriority(.defaultHigh, for: .horizontal)
        filterControl.translatesAutoresizingMaskIntoConstraints = false

        countLabel.toolTip = "всего записей / подмен"
        countLabel.setContentHuggingPriority(.defaultHigh, for: .horizontal)

        let replayItem = actionsMenu.addItem(
            withTitle: "Повторить выбранный запрос",
            action: #selector(replaySelected),
            keyEquivalent: ""
        )
        replayItem.target = self
        let pauseItem = actionsMenu.addItem(
            withTitle: "Пауза записи",
            action: #selector(togglePause(_:)),
            keyEquivalent: ""
        )
        pauseItem.target = self
        let errorsItem = actionsMenu.addItem(
            withTitle: "Только ошибки 4xx-5xx",
            action: #selector(toggleOnlyErrors(_:)),
            keyEquivalent: ""
        )
        errorsItem.target = self
        let exportItem = actionsMenu.addItem(
            withTitle: "Экспортировать журнал…",
            action: #selector(exportLog),
            keyEquivalent: ""
        )
        exportItem.target = self
        actionsMenu.addItem(.separator())
        let clearItem = actionsMenu.addItem(
            withTitle: "Очистить список…",
            action: #selector(clearLog),
            keyEquivalent: ""
        )
        clearItem.target = self

        let actionsButton = makeIconButton(
            symbol: "ellipsis",
            tooltip: "Действия с журналом",
            target: self,
            action: #selector(showActionsMenu(_:))
        )

        let searchRow = makeRow(
            [searchField, bodySearchButton, filterControl, countLabel, actionsButton],
            spacing: 6
        )
        searchRow.distribution = .fill

        tableView.headerView = nil
        tableView.style = .plain
        tableView.rowHeight = 28
        tableView.intercellSpacing = NSSize(width: 0, height: 0)
        tableView.usesAlternatingRowBackgroundColors = false
        tableView.allowsEmptySelection = true
        tableView.dataSource = self
        tableView.delegate = self
        tableView.target = self
        tableView.action = #selector(openSelectedEvent)
        tableView.menu = makeContextMenu()
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("log"))
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
            emptyLabel.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            emptyLabel.leadingAnchor.constraint(greaterThanOrEqualTo: container.leadingAnchor, constant: 8)
        ])

        let columnStack = makeColumn([searchRow, container], spacing: 6)
        columnStack.alignment = .leading
        NSLayoutConstraint.activate([
            searchRow.widthAnchor.constraint(equalTo: columnStack.widthAnchor),
            container.widthAnchor.constraint(equalTo: columnStack.widthAnchor)
        ])
        container.setContentHuggingPriority(.defaultLow, for: .vertical)
        view.addSubview(columnStack)
        columnStack.pinEdges(to: view, insets: NSEdgeInsets(top: 8, left: 8, bottom: 8, right: 8))
    }

    /// Подписывается на события прокси и показывает накопленный журнал
    private func bindRuntime() {
        entries = runtime.controller?.recentEntries() ?? []
        if entries.count > Self.maxEntries {
            entries.removeFirst(entries.count - Self.maxEntries)
        }
        matchedTotal = entries.filter { $0.event == .matched }.count
        rebuildVisible()
        guard let controller = runtime.controller else {
            emptyLabel.stringValue = runtime.startupError ?? "Прокси недоступен"
            return
        }
        controller.onLogBatch = { [weak self] metas in
            self?.append(metas)
        }
        controller.onWarning = { [weak self] message in
            self?.onWarning?(message)
        }
    }

    /// Добавляет новые записи журнала в список
    private func append(_ metas: [LogEntryMeta]) {
        guard !metas.isEmpty, !isPaused else {
            return
        }
        let incoming = metas.count > Self.maxEntries ? Array(metas.suffix(Self.maxEntries)) : metas
        entries.append(contentsOf: incoming)
        matchedTotal += incoming.filter { $0.event == .matched }.count
        if entries.count > Self.maxEntries {
            let extra = entries.count - Self.maxEntries
            matchedTotal -= entries.prefix(extra).filter { $0.event == .matched }.count
            entries.removeFirst(extra)
        }
        guard !isFiltering else {
            rebuildVisible()
            return
        }
        // без поиска и фильтра новые записи просто встают в начало списка
        visible.insert(contentsOf: incoming.reversed(), at: 0)
        if visible.count > Self.maxEntries {
            visible.removeLast(visible.count - Self.maxEntries)
        }
        let added = min(incoming.count, visible.count)
        tableView.insertRows(at: IndexSet(integersIn: 0..<added), withAnimation: [])
        updateCounters()
    }

    /// Активен ли поиск или фильтр по списку
    private var isFiltering: Bool {
        let query = searchField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let filter = EventFilter(rawValue: filterControl.selectedSegment) ?? .all
        return !query.isEmpty || filter != .all || bodyMatches != nil || onlyErrors
    }

    /// Пересчитывает видимый список: новые записи сверху, с учётом фильтра и поиска
    private func rebuildVisible() {
        let query = searchField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let filter = EventFilter(rawValue: filterControl.selectedSegment) ?? .all
        var result: [LogEntryMeta] = []
        for entry in entries.reversed() {
            // повтор запроса - результат явного действия пользователя, показываем при любом фильтре
            if filter == .matched, entry.event != .matched, entry.event != .replay {
                continue
            }
            if onlyErrors, !AppTheme.isHttpError(entry.statusCode) {
                continue
            }
            if !query.isEmpty {
                let matchesUrl = entry.url.lowercased().contains(query)
                let matchesFile = entry.event == .matched && entry.file.lowercased().contains(query)
                let matchesBody = bodyMatches?.contains(entry.ts) ?? false
                if !matchesUrl && !matchesFile && !matchesBody {
                    continue
                }
            }
            result.append(entry)
        }
        visible = result
        tableView.reloadData()
        updateCounters()
    }

    /// Обновляет счётчик записей и подмен и текст пустого состояния
    private func updateCounters() {
        countLabel.stringValue = "\(entries.count) / \(matchedTotal)"
        if visible.isEmpty {
            emptyLabel.stringValue = entries.isEmpty ? "Записей пока нет" : "Ничего не найдено"
            emptyLabel.isHidden = false
        } else {
            emptyLabel.isHidden = true
        }
    }

    /// Открывает меню действий с журналом под кнопкой «…»
    @objc private func showActionsMenu(_ sender: NSButton) {
        for item in actionsMenu.items {
            switch item.action {
            case #selector(togglePause(_:)):
                item.state = isPaused ? .on : .off
                item.title = isPaused ? "Продолжить запись" : "Пауза записи"
            case #selector(toggleOnlyErrors(_:)):
                item.state = onlyErrors ? .on : .off
            default:
                break
            }
        }
        actionsMenu.popUp(positioning: nil, at: NSPoint(x: 0, y: sender.bounds.height + 4), in: sender)
    }

    /// Приостанавливает и возобновляет показ новых записей
    @objc private func togglePause(_ sender: Any?) {
        isPaused.toggle()
        guard !isPaused else {
            return
        }
        // пока список стоял на паузе, записи продолжали писаться на диск - дочитываем их
        entries = runtime.controller?.recentEntries() ?? entries
        if entries.count > Self.maxEntries {
            entries.removeFirst(entries.count - Self.maxEntries)
        }
        matchedTotal = entries.filter { $0.event == .matched }.count
        rebuildVisible()
    }

    /// Включает и выключает показ только ответов с ошибкой
    @objc private func toggleOnlyErrors(_ sender: Any?) {
        onlyErrors.toggle()
        rebuildVisible()
    }

    /// Ставит фокус в поле поиска журнала (Cmd+F)
    @objc func focusSearchField(_ sender: Any?) {
        view.window?.makeFirstResponder(searchField)
    }

    /// Повторяет выбранную запись журнала (Cmd+R)
    @objc func replaySelectedRequest(_ sender: Any?) {
        replaySelected()
    }

    /// Сбрасывает поиск и фильтр журнала (Esc)
    @objc func resetFilter(_ sender: Any?) {
        bodySearchTask?.cancel()
        searchField.stringValue = ""
        bodySearchButton.state = .off
        bodyMatches = nil
        filterControl.selectedSegment = 0
        rebuildVisible()
    }

    override func cancelOperation(_ sender: Any?) {
        resetFilter(sender)
    }

    /// Применяет поиск: по URL и файлу сразу, по телам - через хранилище журнала
    @objc private func applySearch() {
        bodySearchTask?.cancel()
        let query = searchField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty, let controller = runtime.controller else {
            bodyMatches = nil
            rebuildVisible()
            return
        }
        bodySearchTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(250))
            guard let self, !Task.isCancelled else {
                return
            }
            let inBody = bodySearchButton.state == .on
            // вместе с текущей сессией просматриваются и файлы прошлых сессий
            let found = controller.search(query: query, searchInBody: inBody, includeHistory: true)
            guard !Task.isCancelled else {
                return
            }
            mergeFoundFromHistory(found)
            bodyMatches = Set(found.map { $0.ts })
            rebuildVisible()
        }
    }

    /// Добавляет в список записи, найденные в файлах прошлых сессий
    private func mergeFoundFromHistory(_ found: [LogEntryMeta]) {
        let known = Set(entries.map { $0.ts })
        let extra = found.filter { !known.contains($0.ts) }.suffix(Self.maxEntries)
        guard !extra.isEmpty else {
            return
        }
        entries.append(contentsOf: extra)
        entries.sort { $0.ts < $1.ts }
        matchedTotal += extra.filter { $0.event == .matched }.count
    }

    /// Очищает журнал в интерфейсе (файл журнала остаётся на диске)
    @objc private func clearLog() {
        let filter = EventFilter(rawValue: filterControl.selectedSegment) ?? .all
        let keepsMatched = filter == .matched
        let alert = NSAlert()
        alert.messageText = keepsMatched ? "Убрать из списка записи о подменах?" : "Очистить журнал?"
        alert.informativeText = "Файл журнала на диске останется - очищается только список в окне."
        alert.addButton(withTitle: "Очистить")
        alert.addButton(withTitle: "Отмена")
        guard alert.runModal() == .alertFirstButtonReturn else {
            return
        }
        entries = keepsMatched ? entries.filter { $0.event != .matched } : []
        matchedTotal = 0
        rebuildVisible()
    }

    /// Просит файл и экспортирует журнал в HAR, JSON или CSV по выбранному расширению
    @objc private func exportLog() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "file-switcher-log"
        panel.allowedContentTypes = LogExportFormat.allCases.compactMap { format in
            UTType(filenameExtension: format.rawValue)
        }
        guard panel.runModal() == .OK, let url = panel.url else {
            return
        }
        let format = LogExportFormat(rawValue: url.pathExtension.lowercased()) ?? .json
        do {
            try LogExport.stream(sourcePath: runtime.store.filePath, destinationPath: url.path, format: format)
        } catch {
            showAlert("Не удалось экспортировать журнал", error.localizedDescription)
        }
    }

    /// Повторяет выбранный запрос мимо прокси и добавляет запись в список
    @objc private func replaySelected() {
        guard let event = eventForAction() else {
            return
        }
        replay(event)
    }

    /// Отправляет запрос повторно и показывает результат в журнале
    private func replay(_ event: ProxyLogEvent) {
        Task { @MainActor in
            do {
                let replayEvent = try await ReplayRequest.replay(event)
                append(runtime.store.appendBatch([replayEvent]))
            } catch {
                showAlert("Не удалось повторить запрос", error.localizedDescription)
            }
        }
    }

    /// Открывает детали записи под курсором
    @objc private func openSelectedEvent() {
        let row = tableView.clickedRow >= 0 ? tableView.clickedRow : tableView.selectedRow
        guard row >= 0, row < visible.count else {
            return
        }
        openDetails(for: visible[row].ts)
    }


    /// Показывает модальную панель с заголовками и телами запроса
    func openDetails(for ts: Double) {
        guard let event = runtime.controller?.event(ts: ts) else {
            showAlert("Запись недоступна", "Этой записи больше нет в файле журнала")
            return
        }
        let sheet = LogDetailSheet(event: event)
        sheet.onCreateRule = { [weak self] logged in
            self?.onCreateRule?(logged)
        }
        sheet.onReplay = { [weak self] logged in
            self?.replay(logged)
        }
        presentAsSheet(sheet)
    }

    /// Полная запись для строки, по которой вызвали действие, или предупреждение
    private func eventForAction() -> ProxyLogEvent? {
        let row = tableView.clickedRow >= 0 ? tableView.clickedRow : tableView.selectedRow
        guard row >= 0, row < visible.count, let event = runtime.controller?.event(ts: visible[row].ts) else {
            showAlert("Запись недоступна", "Выберите запись в журнале")
            return nil
        }
        return event
    }

    /// Показывает модальное сообщение
    private func showAlert(_ title: String, _ text: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = text
        alert.alertStyle = .warning
        alert.runModal()
    }

    /// Меню правого клика по строке журнала
    private func makeContextMenu() -> NSMenu {
        let menu = NSMenu()
        let createItem = menu.addItem(
            withTitle: "Создать правило подмены",
            action: #selector(createRuleFromRow),
            keyEquivalent: ""
        )
        createItem.target = self
        let copyMenu = NSMenu()
        let copyUrlItem = copyMenu.addItem(withTitle: "Копировать URL", action: #selector(copyUrl), keyEquivalent: "")
        copyUrlItem.target = self
        let copyCurlItem = copyMenu.addItem(
            withTitle: "Копировать как cURL",
            action: #selector(copyAsCurl),
            keyEquivalent: ""
        )
        copyCurlItem.target = self
        let copyItem = NSMenuItem(title: "Копировать", action: nil, keyEquivalent: "")
        copyItem.submenu = copyMenu
        menu.addItem(copyItem)
        let replayItem = menu.addItem(withTitle: "Повторить запрос", action: #selector(replayRow), keyEquivalent: "")
        replayItem.target = self
        return menu
    }

    /// Создаёт черновик правила из записи журнала
    @objc private func createRuleFromRow() {
        guard let event = eventForAction() else {
            return
        }
        onCreateRule?(event)
    }

    /// Копирует URL записи в буфер обмена
    @objc private func copyUrl() {
        guard let event = eventForAction() else {
            return
        }
        copyToClipboard(event.url)
    }

    /// Копирует запрос в виде готовой команды curl
    @objc private func copyAsCurl() {
        guard let event = eventForAction() else {
            return
        }
        copyToClipboard(EventFormatter.curl(event))
    }

    /// Повторяет запрос из контекстного меню
    @objc private func replayRow() {
        guard let event = eventForAction() else {
            return
        }
        replay(event)
    }

    /// Кладёт текст в системный буфер обмена
    private func copyToClipboard(_ text: String) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
    }
}

extension TrafficViewController: NSTableViewDataSource, NSTableViewDelegate {
    func numberOfRows(in tableView: NSTableView) -> Int {
        visible.count
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        guard row < visible.count else {
            return nil
        }
        let identifier = NSUserInterfaceItemIdentifier("log-cell")
        let cell = tableView.makeView(withIdentifier: identifier, owner: self) as? LogCellView
            ?? LogCellView(identifier: identifier)
        cell.apply(entry: visible[row])
        return cell
    }

    func tableView(_ tableView: NSTableView, rowViewForRow row: Int) -> NSTableRowView? {
        let rowView = LogRowView()
        guard row < visible.count else {
            return rowView
        }
        switch visible[row].event {
        case .matched:
            rowView.fillColor = AppTheme.matchedRow
        case .replay:
            rowView.fillColor = AppTheme.replayRow
        case .passed:
            rowView.fillColor = nil
        }
        return rowView
    }
}

extension TrafficViewController: NSMenuDelegate {
    func menuNeedsUpdate(_ menu: NSMenu) {
        let row = tableView.clickedRow
        guard row >= 0, row < visible.count else {
            return
        }
        // бинарное тело запроса в лог не сохраняется - повторять нечего
        let canReplay = !visible[row].requestBodyIsBinary
        for item in menu.items where item.action == #selector(replayRow) {
            item.isEnabled = canReplay
        }
    }
}

/// Строка списка журнала: метод, статус, время и URL с файлом подмены
@MainActor
final class LogCellView: NSStackView {
    private let methodLabel = makeLabel("", font: AppTheme.compactBoldFont)
    private let statusLabel = makeLabel("", font: AppTheme.compactBoldFont)
    private let timeLabel = makeLabel("", font: AppTheme.compactFont, color: .secondaryLabelColor)
    private let urlLabel = makeLabel("", font: AppTheme.compactFont)

    init(identifier: NSUserInterfaceItemIdentifier) {
        super.init(frame: .zero)
        self.identifier = identifier
        orientation = .horizontal
        alignment = .centerY
        spacing = 6
        edgeInsets = NSEdgeInsets(top: 0, left: 6, bottom: 0, right: 6)

        methodLabel.alignment = .left
        statusLabel.alignment = .left
        methodLabel.setContentHuggingPriority(.defaultHigh, for: .horizontal)
        statusLabel.setContentHuggingPriority(.defaultHigh, for: .horizontal)
        timeLabel.setContentHuggingPriority(.defaultHigh, for: .horizontal)
        urlLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        addArrangedSubview(methodLabel)
        addArrangedSubview(statusLabel)
        addArrangedSubview(timeLabel)
        addArrangedSubview(urlLabel)
        NSLayoutConstraint.activate([
            methodLabel.widthAnchor.constraint(equalToConstant: 52),
            statusLabel.widthAnchor.constraint(equalToConstant: 34),
            timeLabel.widthAnchor.constraint(equalToConstant: 58)
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) не используется")
    }

    /// Заполняет строку данными записи журнала
    func apply(entry: LogEntryMeta) {
        methodLabel.stringValue = entry.method
        statusLabel.stringValue = entry.statusCode.map(String.init) ?? "-"
        statusLabel.textColor = AppTheme.httpStatusColor(entry.statusCode)
        timeLabel.stringValue = MetaFormat.time(entry.ts)
        if entry.event == .matched, !entry.file.isEmpty {
            urlLabel.stringValue = "\(entry.url)  →  \(MetaFormat.stripHome(entry.file))"
            urlLabel.textColor = .labelColor
        } else {
            urlLabel.stringValue = entry.url
            urlLabel.textColor = .labelColor
        }
        toolTip = entry.url
    }
}

/// Строка списка с фоном по типу события журнала
@MainActor
final class LogRowView: NSTableRowView {
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

