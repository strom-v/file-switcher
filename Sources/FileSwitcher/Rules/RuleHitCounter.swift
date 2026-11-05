import Foundation

/// Счётчик срабатываний правил за сессию
final class RuleHitCounter: @unchecked Sendable {
    static let shared = RuleHitCounter()

    private let lock = NSLock()
    private var counts: [String: Int] = [:]

    /// Отмечает срабатывание правила
    func register(ruleId: String) {
        lock.lock()
        counts[ruleId, default: 0] += 1
        lock.unlock()
    }

    /// Сколько раз правило сработало за сессию
    func count(ruleId: String) -> Int {
        lock.lock()
        defer {
            lock.unlock()
        }
        return counts[ruleId] ?? 0
    }

    /// Сбрасывает все счётчики
    func reset() {
        lock.lock()
        counts.removeAll()
        lock.unlock()
    }
}
