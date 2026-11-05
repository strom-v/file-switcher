import AppKit

/// Узел дерева JSON: контейнер с детьми или простое значение
final class JSONTreeNode {
    let key: String
    let value: String
    let children: [JSONTreeNode]
    /// Ключ и значение одной строкой для списка
    var label: String {
        if key.isEmpty {
            return value
        }
        return children.isEmpty ? "\(key): \(value)" : "\(key) \(value)"
    }

    init(key: String, value: String, children: [JSONTreeNode]) {
        self.key = key
        self.value = value
        self.children = children
    }

    /// true, если текст разбирается как JSON
    static func isJSON(_ text: String) -> Bool {
        guard let data = text.data(using: .utf8) else {
            return false
        }
        return (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) != nil
    }

    /// Корневые узлы дерева для текста JSON
    static func parse(text: String) -> [JSONTreeNode] {
        guard let data = text.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else {
            return []
        }
        return nodes(from: object, key: "")
    }

    /// Узлы для произвольного значения JSON
    private static func nodes(from object: Any, key: String) -> [JSONTreeNode] {
        if let dictionary = object as? [String: Any] {
            var children: [JSONTreeNode] = []
            for name in dictionary.keys.sorted() {
                children.append(contentsOf: nodes(from: dictionary[name] as Any, key: name))
            }
            return [JSONTreeNode(key: key, value: "{ \(dictionary.count) }", children: children)]
        }
        if let array = object as? [Any] {
            var children: [JSONTreeNode] = []
            for (index, item) in array.enumerated() {
                children.append(contentsOf: nodes(from: item, key: "[\(index)]"))
            }
            return [JSONTreeNode(key: key, value: "[ \(array.count) ]", children: children)]
        }
        return [JSONTreeNode(key: key, value: describe(object), children: [])]
    }

    /// Скалярное значение JSON в читаемом виде
    private static func describe(_ object: Any) -> String {
        if let string = object as? String {
            return "\"\(string)\""
        }
        if let number = object as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return number.boolValue ? "true" : "false"
            }
            return number.stringValue
        }
        return "null"
    }
}

/// Раскрывающееся дерево JSON для тел запроса и ответа в деталях записи
@MainActor
final class JSONTreeView: NSView, NSOutlineViewDataSource, NSOutlineViewDelegate {
    private let root: [JSONTreeNode]
    private let outline = NSOutlineView()

    init(json: String) {
        root = JSONTreeNode.parse(text: json)
        super.init(frame: .zero)
        buildLayout()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) не используется")
    }

    /// Собирает прокручиваемое дерево
    private func buildLayout() {
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("json"))
        column.resizingMask = .autoresizingMask
        outline.addTableColumn(column)
        outline.outlineTableColumn = column
        outline.headerView = nil
        outline.style = .plain
        outline.rowHeight = 20
        outline.usesAlternatingRowBackgroundColors = false
        outline.dataSource = self
        outline.delegate = self
        outline.autoresizingMask = [.width, .height]

        let scroll = NSScrollView()
        scroll.documentView = outline
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.drawsBackground = false
        addSubview(scroll)
        scroll.pinEdges(to: self)
        outline.reloadData()
        outline.expandItem(nil, expandChildren: false)
    }

    func outlineView(_ outlineView: NSOutlineView, numberOfChildrenOfItem item: Any?) -> Int {
        guard let node = item as? JSONTreeNode else {
            return root.count
        }
        return node.children.count
    }

    func outlineView(_ outlineView: NSOutlineView, child index: Int, ofItem item: Any?) -> Any {
        guard let node = item as? JSONTreeNode else {
            return root[index]
        }
        return node.children[index]
    }

    func outlineView(_ outlineView: NSOutlineView, isItemExpandable item: Any) -> Bool {
        guard let node = item as? JSONTreeNode else {
            return false
        }
        return !node.children.isEmpty
    }

    func outlineView(_ outlineView: NSOutlineView, viewFor tableColumn: NSTableColumn?, item: Any) -> NSView? {
        guard let node = item as? JSONTreeNode else {
            return nil
        }
        let identifier = NSUserInterfaceItemIdentifier("jsonCell")
        let cell = outlineView.makeView(withIdentifier: identifier, owner: self) as? NSTableCellView
            ?? makeCell(identifier)
        cell.textField?.stringValue = node.label
        return cell
    }

    /// Ячейка строки дерева с моноширинным текстом
    private func makeCell(_ identifier: NSUserInterfaceItemIdentifier) -> NSTableCellView {
        let cell = NSTableCellView()
        cell.identifier = identifier
        let field = NSTextField(labelWithString: "")
        field.font = AppTheme.monoFont
        field.lineBreakMode = .byTruncatingTail
        field.translatesAutoresizingMaskIntoConstraints = false
        cell.addSubview(field)
        cell.textField = field
        NSLayoutConstraint.activate([
            field.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 2),
            field.trailingAnchor.constraint(equalTo: cell.trailingAnchor, constant: -2),
            field.centerYAnchor.constraint(equalTo: cell.centerYAnchor)
        ])
        return cell
    }
}
