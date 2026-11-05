import AppKit

/// Главное меню приложения: стандартные команды, тема, поиск по журналу и новое правило
@MainActor
enum AppMenu {
    /// Собирает главное меню и назначает его приложению
    static func install(appDelegate: AppDelegate) {
        let main = NSMenu()
        main.addItem(applicationItem(appDelegate: appDelegate))
        main.addItem(editItem())
        main.addItem(viewItem(appDelegate: appDelegate))
        main.addItem(logItem())
        main.addItem(rulesItem())
        main.addItem(windowItem())
        NSApp.mainMenu = main
    }

    /// Меню приложения: о программе, настройки, скрыть и выход
    private static func applicationItem(appDelegate: AppDelegate) -> NSMenuItem {
        let item = NSMenuItem()
        let menu = NSMenu(title: "FileSwitcher")

        let about = NSMenuItem(
            title: "О FileSwitcher",
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        )
        about.target = NSApp
        menu.addItem(about)
        menu.addItem(.separator())

        let settings = NSMenuItem(title: "Настройки…", action: #selector(AppDelegate.showSettings(_:)), keyEquivalent: ",")
        settings.target = appDelegate
        menu.addItem(settings)
        menu.addItem(.separator())

        let hide = NSMenuItem(title: "Скрыть FileSwitcher", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        hide.target = NSApp
        menu.addItem(hide)

        let quit = NSMenuItem(title: "Завершить FileSwitcher", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quit.target = NSApp
        menu.addItem(quit)

        item.submenu = menu
        return item
    }

    /// Меню правки: отмена, буфер обмена и выделение
    private static func editItem() -> NSMenuItem {
        let item = NSMenuItem()
        let menu = NSMenu(title: "Правка")
        menu.addItem(withTitle: "Отменить", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = NSMenuItem(title: "Повторить", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        menu.addItem(redo)
        menu.addItem(.separator())
        menu.addItem(withTitle: "Вырезать", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        menu.addItem(withTitle: "Копировать", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        menu.addItem(withTitle: "Вставить", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        menu.addItem(withTitle: "Выделить всё", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        item.submenu = menu
        return item
    }

    /// Меню вида: выбор темы оформления
    private static func viewItem(appDelegate: AppDelegate) -> NSMenuItem {
        let item = NSMenuItem()
        let menu = NSMenu(title: "Вид")
        let themeItem = NSMenuItem(title: "Тема", action: nil, keyEquivalent: "")
        let themeMenu = NSMenu(title: "Тема")
        for mode in AppearanceSettings.Mode.allCases {
            let entry = NSMenuItem(
                title: mode.title,
                action: #selector(AppDelegate.selectAppearance(_:)),
                keyEquivalent: ""
            )
            entry.target = appDelegate
            entry.representedObject = mode.rawValue
            themeMenu.addItem(entry)
        }
        themeItem.submenu = themeMenu
        menu.addItem(themeItem)
        item.submenu = menu
        return item
    }

    /// Меню журнала: фокус в поиск и повтор выбранного запроса
    private static func logItem() -> NSMenuItem {
        let item = NSMenuItem()
        let menu = NSMenu(title: "Журнал")
        menu.addItem(
            withTitle: "Найти",
            action: #selector(TrafficViewController.focusSearchField(_:)),
            keyEquivalent: "f"
        )
        menu.addItem(
            withTitle: "Повторить запрос",
            action: #selector(TrafficViewController.replaySelectedRequest(_:)),
            keyEquivalent: "r"
        )
        item.submenu = menu
        return item
    }

    /// Меню правил: создание нового правила
    private static func rulesItem() -> NSMenuItem {
        let item = NSMenuItem()
        let menu = NSMenu(title: "Правила")
        menu.addItem(
            withTitle: "Новое правило",
            action: #selector(RulesViewController.createNewRule(_:)),
            keyEquivalent: "n"
        )
        item.submenu = menu
        return item
    }

    /// Меню окна: свернуть и закрыть
    private static func windowItem() -> NSMenuItem {
        let item = NSMenuItem()
        let menu = NSMenu(title: "Окно")
        menu.addItem(withTitle: "Свернуть", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        menu.addItem(withTitle: "Закрыть окно", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        item.submenu = menu
        return item
    }
}
