import AppKit

/// Панель деталей записи журнала: сводка, заголовки и тела запроса и ответа
@MainActor
final class LogDetailSheet: NSViewController {
    private let event: ProxyLogEvent
    /// Создать правило подмены из этой записи
    var onCreateRule: ((ProxyLogEvent) -> Void)?
    /// Отправить запрос повторно
    var onReplay: ((ProxyLogEvent) -> Void)?

    init(event: ProxyLogEvent) {
        self.event = event
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) не используется")
    }

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 680, height: 560))
        buildLayout()
    }

    /// Собирает сводку, вкладки с заголовками и телами и кнопки действий
    private func buildLayout() {
        let tabs = NSTabView()
        tabs.tabViewType = .topTabsBezelBorder
        tabs.translatesAutoresizingMaskIntoConstraints = false
        tabs.addTabViewItem(makeTab(title: "Заголовки запроса", text: EventFormatter.headers(event.requestHeaders)))
        tabs.addTabViewItem(makeTab(title: "Заголовки ответа", text: EventFormatter.headers(event.responseHeaders)))
        tabs.addTabViewItem(makeTab(title: "Тело запроса", text: bodyText(
            event.requestBody,
            isBinary: event.requestBodyIsBinary,
            size: event.requestBodySize
        )))
        tabs.addTabViewItem(makeTab(title: "Тело ответа", text: bodyText(
            event.responseBody,
            isBinary: event.responseBodyIsBinary,
            size: event.responseSize
        )))

        let createButton = ClosureButton(title: "Создать правило") { [weak self] in
            guard let self else {
                return
            }
            dismiss(nil)
            onCreateRule?(event)
        }
        let replayButton = ClosureButton(title: "Повторить") { [weak self] in
            guard let self else {
                return
            }
            dismiss(nil)
            onReplay?(event)
        }
        replayButton.isEnabled = !event.requestBodyIsBinary
        let copyButton = ClosureButton(title: "Копировать всё") { [weak self] in
            guard let self else {
                return
            }
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(EventFormatter.describe(event), forType: .string)
        }
        let closeButton = ClosureButton(title: "Закрыть") { [weak self] in
            self?.dismiss(nil)
        }
        closeButton.keyEquivalent = "\r"

        let bottomRow = makeRow([createButton, replayButton, copyButton, makeSpacer(), closeButton], spacing: 8)
        bottomRow.distribution = .fill

        let summary = makeSummary()
        let column = makeColumn([summary, tabs, bottomRow], spacing: 10)
        column.alignment = .leading
        NSLayoutConstraint.activate([
            summary.widthAnchor.constraint(equalTo: column.widthAnchor),
            tabs.widthAnchor.constraint(equalTo: column.widthAnchor),
            bottomRow.widthAnchor.constraint(equalTo: column.widthAnchor),
            tabs.heightAnchor.constraint(greaterThanOrEqualToConstant: 260)
        ])
        view.addSubview(column)
        column.pinEdges(to: view, insets: NSEdgeInsets(top: 12, left: 14, bottom: 14, right: 14))
    }


    /// Таблица со сводкой запроса: адрес, метод, статус, время и размер
    private func makeSummary() -> NSView {
        let urlLabel = makeLabel(event.url, font: AppTheme.compactFont)
        urlLabel.lineBreakMode = .byTruncatingMiddle
        urlLabel.toolTip = event.url

        let statusLabel = makeLabel(event.statusCode.map(String.init) ?? "-", font: AppTheme.compactBoldFont)
        statusLabel.textColor = AppTheme.httpStatusColor(event.statusCode)

        let grid = NSGridView(views: [
            [makeFieldLabel("URL"), urlLabel],
            [makeFieldLabel("Метод"), makeLabel(event.method, font: AppTheme.compactBoldFont)],
            [makeFieldLabel("Статус"), statusLabel],
            [makeFieldLabel("Время"), makeLabel(MetaFormat.time(event.ts, withDate: true), font: AppTheme.compactFont)],
            [makeFieldLabel("Размер"), makeLabel(MetaFormat.size(event.responseSize), font: AppTheme.compactFont)]
        ])
        grid.translatesAutoresizingMaskIntoConstraints = false
        grid.rowSpacing = 4
        grid.columnSpacing = 8
        grid.column(at: 0).xPlacement = .trailing
        for index in 0..<grid.numberOfRows {
            grid.row(at: index).yPlacement = .center
        }
        return grid
    }

    /// Подпись поля в сводке
    private func makeFieldLabel(_ text: String) -> NSTextField {
        makeLabel(text, font: AppTheme.compactFont, color: .secondaryLabelColor)
    }

    /// Вкладка с прокручиваемым текстом только для чтения
    private func makeTab(title: String, text: String) -> NSTabViewItem {
        let textView = NSTextView()
        textView.isEditable = false
        textView.isRichText = false
        textView.font = AppTheme.monoFont
        textView.textContainerInset = NSSize(width: 6, height: 6)
        textView.isHorizontallyResizable = false
        textView.textContainer?.widthTracksTextView = true
        textView.string = text
        textView.autoresizingMask = [.width, .height]

        let scroll = NSScrollView()
        scroll.documentView = textView
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true

        let item = NSTabViewItem(identifier: title)
        item.label = title
        item.view = scroll
        return item
    }

    /// Текст тела запроса или пометка о бинарном содержимом
    private func bodyText(_ body: String, isBinary: Bool, size: Int) -> String {
        if isBinary {
            return "Бинарное тело размером \(MetaFormat.size(size)) - в журнале не сохраняется"
        }
        return body.isEmpty ? "(тела нет)" : body
    }
}
