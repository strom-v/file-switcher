import AppKit

/// Вкладка трафика: состояние прокси, запуск и остановка, журнал запросов
@MainActor
final class TrafficViewController: NSViewController {
    private let runtime: AppRuntime
    private var entries: [LogEntryMeta] = []
    private var filtered: [LogEntryMeta] = []

    private let statusLabel = NSTextField(labelWithString: "Прокси остановлен")
    private let certLabel = NSTextField(labelWithString: "")
    private let vpnLabel = NSTextField(labelWithString: "")
    private let toggleButton = NSButton(title: "Запустить прокси", target: nil, action: nil)
    private let portField = NSTextField(string: String(defaultProxyPort))
    private let searchField = NSSearchField()
    private let searchInBodyBox = NSButton(checkboxWithTitle: "искать в телах", target: nil, action: nil)
    private let clearButton = NSButton(title: "Очистить список", target: nil, action: nil)
    private let tableView = NSTableView()
    private let detailView = NSTextView()

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
        bindRuntime()
        refreshSystemState()
    }

    /// Собирает панель состояния, поиск и таблицу журнала
    private func buildLayout() {
        guard let view = view as NSView? else {
            return
        }

        toggleButton.target = self
        toggleButton.action = #selector(toggleProxy)
        toggleButton.bezelStyle = .rounded
        portField.alignment = .right
        portField.widthAnchor.constraint(equalToConstant: 70).isActive = true

        clearButton.target = self
        clearButton.action = #selector(clearLog)
        searchField.target = self
        searchField.action = #selector(applySearch)
        searchField.placeholderString = "фильтр по URL"
        searchInBodyBox.target = self
        searchInBodyBox.action = #selector(applySearch)

        let topRow = NSStackView(views: [toggleButton, NSTextField(labelWithString: "порт:"), portField, statusLabel])
        topRow.orientation = .horizontal
        topRow.spacing = 8

        let infoRow = NSStackView(views: [certLabel, vpnLabel])
        infoRow.orientation = .horizontal
        infoRow.spacing = 16

        let searchRow = NSStackView(views: [searchField, searchInBodyBox, clearButton])
        searchRow.orientation = .horizontal
        searchRow.spacing = 8

        tableView.usesAlternatingRowBackgroundColors = true
        tableView.dataSource = self
        tableView.delegate = self
        for (title, width) in [("время", 80.0), ("событие", 70.0), ("метод", 60.0), ("статус", 60.0), ("размер", 80.0), ("URL", 400.0)] {
            let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier(title))
            column.title = title
            column.width = width
            tableView.addTableColumn(column)
        }

        let scroll = NSScrollView()
        scroll.documentView = tableView
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder

        detailView.isEditable = false
        detailView.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        let detailScroll = NSScrollView()
        detailScroll.documentView = detailView
        detailScroll.hasVerticalScroller = true
        detailScroll.borderType = .bezelBorder

        let split = NSSplitView()
        split.isVertical = false
        split.dividerStyle = .thin
        split.addArrangedSubview(scroll)
        split.addArrangedSubview(detailScroll)
        split.setHoldingPriority(.defaultLow, forSubviewAt: 1)
        scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 240).isActive = true
        detailScroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 120).isActive = true

        let stack = NSStackView(views: [topRow, infoRow, searchRow, split])
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
            split.widthAnchor.constraint(equalTo: stack.widthAnchor),
            searchField.widthAnchor.constraint(greaterThanOrEqualToConstant: 240)
        ])
    }

    /// Подписывается на события прокси
    private func bindRuntime() {
        entries = runtime.controller?.recentEntries() ?? []
        filtered = entries
        tableView.reloadData()
        guard let controller = runtime.controller else {
            statusLabel.stringValue = runtime.startupError ?? "Прокси недоступен"
            toggleButton.isEnabled = false
            return
        }
        controller.onStateChange = { [weak self] state in
            self?.render(state: state)
        }
        controller.onLogBatch = { [weak self] metas in
            self?.append(metas)
        }
        controller.onWarning = { [weak self] message in
            self?.detailView.string = message
        }
        render(state: controller.state)
    }

    /// Показывает состояние прокси на панели
    private func render(state: ProxyState) {
        switch state.status {
        case .stopped:
            statusLabel.stringValue = "остановлен"
            toggleButton.title = "Запустить прокси"
        case .starting:
            statusLabel.stringValue = "запускается на порту \(state.port)"
            toggleButton.title = "Остановить"
        case .running:
            statusLabel.stringValue = "работает на 127.0.0.1:\(state.port)"
            toggleButton.title = "Остановить"
        case .crashed:
            statusLabel.stringValue = state.error ?? "ошибка запуска"
            toggleButton.title = "Запустить прокси"
        }
    }

    /// Подтягивает статус сертификата и VPN
    private func refreshSystemState() {
        Task { @MainActor in
            let certStatus = await CertTrustDarwin.status()
            certLabel.stringValue = switch certStatus {
            case .trusted: "CA: доверен"
            case .notTrusted: "CA: не доверен"
            case .notGenerated: "CA: нет сертификата"
            }
            let vpn = await VpnDetector.status()
            if vpn.blocksProxy {
                vpnLabel.stringValue = "VPN: весь трафик мимо системного прокси"
            } else if vpn.active {
                vpnLabel.stringValue = "VPN: активен"
            } else {
                vpnLabel.stringValue = "VPN: нет"
            }
        }
    }

    /// Запускает или останавливает прокси
    @objc private func toggleProxy() {
        guard let controller = runtime.controller else {
            return
        }
        if controller.state.status == .running || controller.state.status == .starting {
            controller.stop()
            return
        }
        let port = Int(portField.stringValue) ?? defaultProxyPort
        controller.start(port: port)
    }

    /// Сбрасывает список в интерфейсе (файл журнала остаётся)
    @objc private func clearLog() {
        entries = []
        filtered = []
        tableView.reloadData()
        detailView.string = ""
    }

    /// Применяет фильтр по URL и телу
    @objc private func applySearch() {
        let query = searchField.stringValue
        let searchInBody = searchInBodyBox.state == .on
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty, runtime.controller != nil else {
            filtered = entries
            tableView.reloadData()
            return
        }
        Task { @MainActor in
            let store = runtime.store
            let found = await Task.detached(priority: .userInitiated) {
                store.search(query: query, searchInBody: searchInBody)
            }.value
            filtered = found
            tableView.reloadData()
        }
    }

    /// Добавляет пачку записей и прокручивает к последней
    private func append(_ metas: [LogEntryMeta]) {
        guard !metas.isEmpty else {
            return
        }
        entries.append(contentsOf: metas)
        if searchField.stringValue.trimmingCharacters(in: .whitespaces).isEmpty {
            filtered = entries
        }
        tableView.reloadData()
        if !filtered.isEmpty {
            tableView.scrollRowToVisible(filtered.count - 1)
        }
    }
}

/// Таблица журнала: строки и выбор записи
extension TrafficViewController: NSTableViewDataSource, NSTableViewDelegate {
    func numberOfRows(in tableView: NSTableView) -> Int {
        filtered.count
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        guard let column = tableColumn, row < filtered.count else {
            return nil
        }
        let entry = filtered[row]
        let identifier = column.identifier
        let cell = NSTextField(labelWithString: text(for: entry, column: identifier.rawValue))
        cell.lineBreakMode = .byTruncatingMiddle
        cell.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        return cell
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        let row = tableView.selectedRow
        guard row >= 0, row < filtered.count, let event = runtime.controller?.event(ts: filtered[row].ts) else {
            detailView.string = ""
            return
        }
        detailView.string = EventFormatter.describe(event)
    }

    /// Текст ячейки по названию колонки
    private func text(for entry: LogEntryMeta, column: String) -> String {
        switch column {
        case "время":
            let formatter = DateFormatter()
            formatter.dateFormat = "HH:mm:ss.SSS"
            return formatter.string(from: Date(timeIntervalSince1970: entry.ts))
        case "событие":
            return switch entry.event {
            case .matched: "подмена"
            case .passed: "прошёл"
            case .replay: "повтор"
            }
        case "метод":
            return entry.method
        case "статус":
            return entry.statusCode.map(String.init) ?? "-"
        case "размер":
            return "\(entry.responseSize) Б"
        default:
            return entry.url
        }
    }
}
