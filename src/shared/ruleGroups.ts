/**
 * Группировка правил подмены в списке. Группа хранится в Rule.group; для правил,
 * созданных до появления этого поля, она один раз определяется из пути подмены.
 */
import type { Rule } from './types'

/** Ключ, под которым в UI показываются правила без явной группы (пустая строка в Rule.group) */
export const OTHER_GROUP_KEY = ''

/** Ключ группы правила — нормализует undefined/пустую строку к OTHER_GROUP_KEY */
export function groupKeyOf(rule: Rule): string {
  return rule.group || OTHER_GROUP_KEY
}

const CYRILLIC_RE = /[а-яё]/i

/** Сравнивает названия групп: латинские идут перед кириллическими, внутри каждой части — по алфавиту */
export function compareGroupNames(a: string, b: string): number {
  const aIsCyrillic = CYRILLIC_RE.test(a)
  const bIsCyrillic = CYRILLIC_RE.test(b)
  if (aIsCyrillic !== bIsCyrillic) return aIsCyrillic ? 1 : -1
  return a.localeCompare(b)
}

/** Репозиторий из пути подмены — сегмент после ".../projects/<организация>/<репозиторий>/..." */
export function extractRepoFromPath(localFilePath: string | undefined): string | null {
  if (!localFilePath) return null
  const match = localFilePath.match(/\/projects\/[^/]+\/([^/]+)\//)
  return match ? match[1] : null
}

/** Группа правила при первой миграции: из пути, иначе "остальные" (пустая строка) */
export function initialGroupForRule(rule: Rule): string {
  return extractRepoFromPath(rule.localFilePath) ?? OTHER_GROUP_KEY
}
