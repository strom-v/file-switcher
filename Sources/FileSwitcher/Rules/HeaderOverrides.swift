import Foundation

/// Применяет переопределения заголовков: пустое значение удаляет заголовок, отсутствующий добавляет
func applyHeaderOverrides(_ pairs: inout [(String, String)], _ overrides: [HeaderOverride]?) {
    guard let overrides, !overrides.isEmpty else {
        return
    }
    for override in overrides {
        let lowerName = override.name.lowercased()
        let existingIndex = pairs.firstIndex { $0.0.lowercased() == lowerName }
        if override.value.isEmpty {
            if let existingIndex {
                pairs.remove(at: existingIndex)
            }
            continue
        }
        if let existingIndex {
            pairs[existingIndex].1 = override.value
        } else {
            pairs.append((override.name, override.value))
        }
    }
}
