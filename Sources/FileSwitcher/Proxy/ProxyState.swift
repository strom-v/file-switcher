import Foundation
import NIOCore
import NIOPosix

/// Состояние встроенного прокси
enum ProxyStatus: String, Sendable {
    case stopped
    case starting
    case running
    case crashed
}

/// Состояние прокси для интерфейса
struct ProxyState: Sendable, Equatable {
    var status: ProxyStatus
    var port: Int
    var error: String?
}

/// Включение системного HTTP/HTTPS-прокси; реализация зависит от платформы
protocol SystemProxyControlling: Sendable {
    /// Направляет системный трафик на локальный прокси
    func enable(host: String, port: Int) async throws
    /// Возвращает системный прокси в состояние до запуска
    func disable() async throws
    /// Восстанавливает прокси после аварийного завершения прошлого запуска
    func recoverStale(host: String) async throws
}
