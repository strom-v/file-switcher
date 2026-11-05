import Foundation

// Точка входа: самопроверка, прокси без UI (спайк этапа 1) или сообщение о сборке без UI.
let arguments = CommandLine.arguments

if arguments.contains("--system-check") {
    await SystemCheck.run()
    exit(0)
}

if arguments.contains("--selftest") {
    SelfTest.runAndExit()
}

if let flagIndex = arguments.firstIndex(of: "--proxy") {
    let portIndex = flagIndex + 1
    guard portIndex < arguments.count, let port = Int(arguments[portIndex]) else {
        SelfTest.writeError("использование: FileSwitcher --proxy <порт> [--rules <файл>]")
        exit(2)
    }
    var rulesFile: URL?
    if let rulesIndex = arguments.firstIndex(of: "--rules"), rulesIndex + 1 < arguments.count {
        rulesFile = URL(fileURLWithPath: arguments[rulesIndex + 1])
    }
    do {
        try await DebugProxy.run(port: port, rulesFile: rulesFile)
    } catch {
        SelfTest.writeError("прокси не запустился: \(error.localizedDescription)")
        exit(1)
    }
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
