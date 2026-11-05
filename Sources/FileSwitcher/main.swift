import Foundation

// Точка входа: самопроверка, прокси без UI (спайк этапа 1) или сообщение о сборке без UI.
let arguments = CommandLine.arguments

if arguments.contains("--selftest") {
    SelfTest.runAndExit()
}

if let flagIndex = arguments.firstIndex(of: "--proxy-only") {
    let portIndex = flagIndex + 1
    guard portIndex < arguments.count, let port = Int(arguments[portIndex]) else {
        SelfTest.writeError("использование: FileSwitcher --proxy-only <порт>")
        exit(2)
    }
    do {
        try ProxySpike.run(port: port)
    } catch {
        SelfTest.writeError("прокси не запустился: \(error.localizedDescription)")
        exit(1)
    }
}

SelfTest.writeError("FileSwitcher: UI ещё не портирован, доступны --selftest и --proxy-only <порт>")
exit(2)
