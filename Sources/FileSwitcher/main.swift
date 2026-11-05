import AppKit
import Foundation

// Точка входа: самопроверка, проверка системы или приложение с интерфейсом.
let arguments = CommandLine.arguments

if arguments.contains("--system-check") {
    await SystemCheck.run()
    exit(0)
}

if arguments.contains("--selftest") {
    SelfTest.runAndExit()
}

// Без флагов запускается приложение с интерфейсом; делегат держим в глобальной переменной -
// NSApplication.delegate слабая ссылка
let application = NSApplication.shared
let applicationDelegate = AppDelegate()
application.delegate = applicationDelegate
application.run()
