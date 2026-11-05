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
            title: L10n.t("О FileSwitcher"),
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        )
        about.target = NSApp
        menu.addItem(about)
        menu.addItem(.separator())

        let settings = NSMenuItem(title: L10n.t("Настройки…"), action: #selector(AppDelegate.showSettings(_:)), keyEquivalent: ",")
        settings.target = appDelegate
        menu.addItem(settings)
        menu.addItem(.separator())

        let hide = NSMenuItem(title: L10n.t("Скрыть FileSwitcher"), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        hide.target = NSApp
        menu.addItem(hide)

        let quit = NSMenuItem(title: L10n.t("Завершить FileSwitcher"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quit.target = NSApp
        menu.addItem(quit)

        item.submenu = menu
        return item
    }

    /// Меню правки: отмена, буфер обмена и выделение
    private static func editItem() -> NSMenuItem {
        let item = NSMenuItem()
        let menu = NSMenu(title: L10n.t("Правка"))
        menu.addItem(withTitle: L10n.t("Отменить"), action: Selector(("undo:")), keyEquivalent: "z")
        let redo = NSMenuItem(title: L10n.t("Повторить"), action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        menu.addItem(redo)
        menu.addItem(.separator())
        menu.addItem(withTitle: L10n.t("Вырезать"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        menu.addItem(withTitle: L10n.t("Копировать"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        menu.addItem(withTitle: L10n.t("Вставить"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        menu.addItem(withTitle: L10n.t("Выделить всё"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        item.submenu = menu
        return item
    }

    /// Меню вида: выбор темы оформления
    private static func viewItem(appDelegate: AppDelegate) -> NSMenuItem {
        let item = NSMenuItem()
        let menu = NSMenu(title: L10n.t("Вид"))
        let themeItem = NSMenuItem(title: L10n.t("Тема"), action: nil, keyEquivalent: "")
        let themeMenu = NSMenu(title: L10n.t("Тема"))
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
        let menu = NSMenu(title: L10n.t("Журнал"))
        menu.addItem(
            withTitle: L10n.t("Найти"),
            action: #selector(TrafficViewController.focusSearchField(_:)),
            keyEquivalent: "f"
        )
        menu.addItem(
            withTitle: L10n.t("Повторить запрос"),
            action: #selector(TrafficViewController.replaySelectedRequest(_:)),
            keyEquivalent: "r"
        )
        item.submenu = menu
        return item
    }

    /// Меню правил: создание нового правила и импорт из буфера
    private static func rulesItem() -> NSMenuItem {
        let item = NSMenuItem()
        let menu = NSMenu(title: L10n.t("Правила"))
        menu.addItem(
            withTitle: L10n.t("Новое правило"),
            action: #selector(RulesViewController.createNewRule(_:)),
            keyEquivalent: "n"
        )
        menu.addItem(
            withTitle: L10n.t("Импортировать из буфера"),
            action: #selector(RulesViewController.importFromClipboard(_:)),
            keyEquivalent: ""
        )
        item.submenu = menu
        return item
    }

    /// Меню окна: свернуть и закрыть
    private static func windowItem() -> NSMenuItem {
        let item = NSMenuItem()
        let menu = NSMenu(title: L10n.t("Окно"))
        menu.addItem(withTitle: L10n.t("Свернуть"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        menu.addItem(withTitle: L10n.t("Закрыть окно"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        item.submenu = menu
        return item
    }
}
