/**
 * Единый контракт имён заголовков с секретами (токены, сессии, ключи). Их значения не пишутся
 * в лог: файл сессии лежит на диске без шифрования и целиком уходит в HAR/JSON/CSV-экспорт,
 * который пользователи пересылают в баг-репорты.
 *
 * Источник для двух сторон:
 * - Python-аддон обычного трафика (resources/addon.py, зеркальный набор REDACTED_HEADERS)
 * - main-процесс для replay-ответов, которые идут мимо аддона (src/main/replayRequest.ts)
 *
 * resources/test_addon.py падает, если набор в addon.py разошёлся с этим файлом.
 * Имена — в нижнем регистре, сравнение регистронезависимое.
 */
export const REDACTED_HEADER_NAMES = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token'
] as const

const redactedHeaderSet = new Set<string>(REDACTED_HEADER_NAMES)

export const REDACTED_HEADER_PLACEHOLDER = '<redacted by FileSwitcher>'

/** Заменяет значения секретных заголовков плейсхолдером, сохраняя имена и исходный регистр */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    result[name] = redactedHeaderSet.has(name.toLowerCase()) ? REDACTED_HEADER_PLACEHOLDER : value
  }
  return result
}
