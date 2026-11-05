import AppKit

/// Палитра и шрифты интерфейса - те же цвета, что были в прежней Electron-версии
@MainActor
enum AppTheme {
    static let success = NSColor(srgbRed: 0.322, green: 0.769, blue: 0.102, alpha: 1)
    static let warning = NSColor(srgbRed: 0.980, green: 0.678, blue: 0.078, alpha: 1)
    static let danger = NSColor(srgbRed: 1.0, green: 0.302, blue: 0.310, alpha: 1)

    /// Фон строки лога со сработавшей подменой
    static let matchedRow = NSColor(srgbRed: 0.322, green: 0.769, blue: 0.102, alpha: 0.08)
    /// Фон строки лога с повторной отправкой запроса
    static let replayRow = NSColor(srgbRed: 0.980, green: 0.859, blue: 0.078, alpha: 0.10)
    /// Фон правила с подменой тела прямо в правиле
    static let bodyRow = NSColor(srgbRed: 0.447, green: 0.180, blue: 0.820, alpha: 0.06)
    /// Фон правила с подменой из локального файла
    static let fileRow = NSColor(srgbRed: 0.094, green: 0.565, blue: 1.0, alpha: 0.05)
    /// Фон полосы с предупреждением
    static let warningBanner = warning.withAlphaComponent(0.12)
    /// Фон полосы с ошибкой (full-tunnel VPN блокирует перехват)
    static let errorBanner = danger.withAlphaComponent(0.12)

    static let baseFont = NSFont.systemFont(ofSize: 13)
    static let compactFont = NSFont.systemFont(ofSize: 12)
    static let compactBoldFont = NSFont.systemFont(ofSize: 12, weight: .semibold)
    static let groupFont = NSFont.systemFont(ofSize: 11, weight: .semibold)
    static let monoFont = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)

    /// Ответ сервера с ошибкой клиента или сервера
    static func isHttpError(_ statusCode: Int?) -> Bool {
        guard let statusCode else {
            return false
        }
        return statusCode >= 400
    }

    /// Цвет значения HTTP-статуса: цветом выделяются только ошибки
    static func httpStatusColor(_ statusCode: Int?) -> NSColor {
        guard let statusCode else {
            return .secondaryLabelColor
        }
        if statusCode >= 500 {
            return danger
        }
        if statusCode >= 400 {
            return warning
        }
        return .secondaryLabelColor
    }

    /// Иконка из SF Symbols нужного размера
    static func symbol(_ name: String, size: CGFloat = 12, weight: NSFont.Weight = .regular) -> NSImage? {
        let configuration = NSImage.SymbolConfiguration(pointSize: size, weight: weight)
        return NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(configuration)
    }
}

/// Подпись с заданным шрифтом и цветом
@MainActor
func makeLabel(_ text: String, font: NSFont = AppTheme.baseFont, color: NSColor = .labelColor) -> NSTextField {
    let label = NSTextField(labelWithString: text)
    label.font = font
    label.textColor = color
    label.lineBreakMode = .byTruncatingTail
    return label
}

/// Горизонтальный стек с выравниванием по центру
@MainActor
func makeRow(_ views: [NSView], spacing: CGFloat = 6) -> NSStackView {
    let stack = NSStackView(views: views)
    stack.orientation = .horizontal
    stack.alignment = .centerY
    stack.spacing = spacing
    stack.translatesAutoresizingMaskIntoConstraints = false
    return stack
}

/// Вертикальный стек с выравниванием по ведущему краю
@MainActor
func makeColumn(_ views: [NSView], spacing: CGFloat = 6) -> NSStackView {
    let stack = NSStackView(views: views)
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = spacing
    stack.translatesAutoresizingMaskIntoConstraints = false
    return stack
}

/// Растяжка, забирающая свободное место в стеке
@MainActor
func makeSpacer() -> NSView {
    let spacer = NSView()
    spacer.translatesAutoresizingMaskIntoConstraints = false
    spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
    spacer.setContentHuggingPriority(.defaultLow, for: .vertical)
    return spacer
}

extension NSView {
    /// Прижимает view ко всем краям контейнера с отступами
    func pinEdges(to other: NSView, insets: NSEdgeInsets = NSEdgeInsets()) {
        translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            leadingAnchor.constraint(equalTo: other.leadingAnchor, constant: insets.left),
            trailingAnchor.constraint(equalTo: other.trailingAnchor, constant: -insets.right),
            topAnchor.constraint(equalTo: other.topAnchor, constant: insets.top),
            bottomAnchor.constraint(equalTo: other.bottomAnchor, constant: -insets.bottom)
        ])
    }
}
