import AppKit

/// Кнопка-иконка без рамки, как в панели инструментов прежней версии
@MainActor
func makeIconButton(
    symbol: String,
    tooltip: String,
    target: AnyObject?,
    action: Selector?,
    tint: NSColor = .labelColor
) -> NSButton {
    let button = NSButton()
    button.image = AppTheme.symbol(symbol)
    button.imagePosition = .imageOnly
    button.isBordered = false
    button.bezelStyle = .regularSquare
    button.contentTintColor = tint
    button.toolTip = tooltip
    button.target = target
    button.action = action
    button.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
        button.widthAnchor.constraint(equalToConstant: 24),
        button.heightAnchor.constraint(equalToConstant: 24)
    ])
    return button
}

/// Кнопка с цветным фоном и белой иконкой (запуск и остановка прокси)
@MainActor
final class FilledIconButton: NSButton {
    /// Цвет фона кнопки
    var fillColor: NSColor {
        didSet {
            layer?.backgroundColor = fillColor.cgColor
        }
    }

    init(symbol: String, tooltip: String, fillColor: NSColor, target: AnyObject?, action: Selector?) {
        self.fillColor = fillColor
        super.init(frame: .zero)
        image = AppTheme.symbol(symbol, size: 12, weight: .bold)
        imagePosition = .imageOnly
        isBordered = false
        bezelStyle = .regularSquare
        contentTintColor = .white
        self.toolTip = tooltip
        self.target = target
        self.action = action
        translatesAutoresizingMaskIntoConstraints = false
        wantsLayer = true
        layer?.backgroundColor = fillColor.cgColor
        layer?.cornerRadius = 4
        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: 26),
            heightAnchor.constraint(equalToConstant: 24)
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) не используется")
    }
}

/// Кнопка, вызывающая замыкание вместо селектора
@MainActor
final class ClosureButton: NSButton {
    private let handler: () -> Void

    init(title: String = "", symbol: String? = nil, handler: @escaping () -> Void) {
        self.handler = handler
        super.init(frame: .zero)
        if let symbol {
            image = AppTheme.symbol(symbol)
            imagePosition = title.isEmpty ? .imageOnly : .imageLeading
        }
        self.title = title
        target = self
        action = #selector(invoke)
        translatesAutoresizingMaskIntoConstraints = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) не используется")
    }

    @objc private func invoke() {
        handler()
    }
}

/// Форматирование значений журнала для списков и деталей
@MainActor
enum MetaFormat {
    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()

    private static let dateTimeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .medium
        return formatter
    }()

    /// Время записи: только часы или полная дата со временем
    static func time(_ ts: Double, withDate: Bool = false) -> String {
        let date = Date(timeIntervalSince1970: ts)
        return withDate ? dateTimeFormatter.string(from: date) : timeFormatter.string(from: date)
    }

    /// Размер в байтах, килобайтах или мегабайтах
    static func size(_ bytes: Int) -> String {
        if bytes >= 1_048_576 {
            return String(format: L10n.t("%.1f МБ"), Double(bytes) / 1_048_576)
        }
        if bytes >= 1024 {
            return String(format: L10n.t("%.1f КБ"), Double(bytes) / 1024)
        }
        return "\(bytes) Б"
    }

    /// Срезает префикс домашней папки - путь в списке правил остаётся компактным
    static func stripHome(_ path: String) -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        guard path.hasPrefix(home + "/") else {
            return path
        }
        return String(path.dropFirst(home.count + 1))
    }
}
