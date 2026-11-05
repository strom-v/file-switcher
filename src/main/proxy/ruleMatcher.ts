import { readFileSync, realpathSync, statSync } from 'fs'
import { readFile, stat } from 'fs/promises'
import { extname, isAbsolute, relative, sep } from 'path'
import { unsafeRegexReason } from '../../shared/regexSafety'
import type { HeaderOverride, Rule } from '../../shared/types'

// URL длиннее этого не прогоняем через regex — ограничивает время матчинга на одном запросе
export const MAX_REGEX_URL_LENGTH = 8_192

// rules.json перечитывается по mtime, но stat на КАЖДЫЙ проксируемый запрос — лишний syscall
// на горячем пути; проверяем не чаще раза в этот интервал (правки правил применяются с задержкой ≤1 с)
const RULES_MTIME_CHECK_INTERVAL_MS = 1_000

// файл-подмену читаем целиком в память — выше этого размера отклоняем, чтобы 100-мегабайтный
// бандл не раздувал память main-процесса
export const MAX_REPLACEMENT_FILE_BYTES = 16 * 1024 * 1024

const GROUP_REFERENCE_RE = /\$(\d+)/g

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.ico': 'image/vnd.microsoft.icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.mjs': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml'
}

export interface RuleMatch {
  rule: Rule
  /** null для точного совпадения URL; для regex — результат exec с группами для $N */
  groups: RegExpExecArray | null
}

/** Тип содержимого по расширению файла */
export function guessContentType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/** Подставляет $N из групп regex-совпадения (как в Fiddler AutoResponder) */
export function substituteGroups(path: string, groups: RegExpExecArray): string {
  return path.replace(GROUP_REFERENCE_RE, (_reference, group: string) => {
    const index = Number(group)
    if (index >= groups.length) throw new RangeError(`в regex нет группы $${group}`)
    return groups[index] ?? ''
  })
}

/** Подставляет группы в localFilePath, не выпуская результат за каталог до первой $N */
export function resolveSubstitutedPath(path: string, groups: RegExpExecArray): string {
  const firstReference = path.search(/\$\d+/)
  if (firstReference === -1) return realpathSync(path)

  // каталог — всё до последнего разделителя перед $N; path.dirname не годится, он отбрасывает
  // завершающий "/" и поднял бы границу на уровень выше
  const trustedPrefix = path.slice(0, firstReference)
  const lastSeparator = trustedPrefix.lastIndexOf(sep)
  if (lastSeparator === -1) {
    throw new Error('до первой $N-подстановки не задан базовый каталог')
  }
  const baseDir = trustedPrefix.slice(0, lastSeparator) || sep

  for (const reference of path.matchAll(GROUP_REFERENCE_RE)) {
    const capture = groups[Number(reference[1])] ?? ''
    if (isAbsolute(capture) || capture.startsWith('\\') || capture.split(/[\\/]/).includes('..')) {
      throw new Error(`небезопасное значение $${reference[1]}`)
    }
  }

  const resolvedBase = realpathSync(baseDir)
  const resolvedPath = realpathSync(substituteGroups(path, groups))
  const fromBase = relative(resolvedBase, resolvedPath)
  if (fromBase.startsWith('..') || isAbsolute(fromBase)) {
    throw new Error('результирующий путь выходит за базовый каталог')
  }
  return resolvedPath
}

/** Применяет переопределения к заголовкам [имя, значение]; пустое value удаляет заголовок */
export function applyHeaderOverrides(headers: [string, string][], overrides: HeaderOverride[] | undefined): void {
  for (const { name, value } of overrides ?? []) {
    if (!name) continue
    const lowerName = name.toLowerCase()
    for (let index = headers.length - 1; index >= 0; index--) {
      if (headers[index][0].toLowerCase() === lowerName) headers.splice(index, 1)
    }
    if (value) headers.push([name, value])
  }
}

/**
 * Индекс правил из rules.json для горячего пути прокси: точные URL — по хешу, regex —
 * предкомпилированы и уже проверены на безопасность. Файл перечитывается по mtime, поэтому
 * ручные правки rules.json подхватываются так же, как сохранения из UI.
 */
export class RuleMatcher {
  private exactRules = new Map<string, Rule>()
  private regexRules: { rule: Rule; regex: RegExp }[] = []
  private lastMtimeMs: number | null = null
  private lastMtimeCheck = 0
  // последняя ошибка чтения rules.json — чтобы не повторять одно и то же предупреждение
  private lastReloadError: string | null = null
  // кэш файлов-подмен: path → содержимое на момент mtime/size, чтобы не перечитывать неизменный бандл
  private replacementCache = new Map<string, { mtimeMs: number; size: number; body: Buffer }>()

  constructor(
    private readonly rulesFilePath: string,
    private readonly warn: (message: string) => void
  ) {
    this.reload('не удалось прочитать rules.json при старте')
  }

  /** Находит первое сработавшее правило для URL */
  match(url: string): RuleMatch | null {
    this.reloadIfChanged()

    const exact = this.exactRules.get(url)
    if (exact) return { rule: exact, groups: null }
    if (url.length > MAX_REGEX_URL_LENGTH) return null

    for (const { rule, regex } of this.regexRules) {
      const groups = regex.exec(url)
      if (groups) return { rule, groups }
    }
    return null
  }

  /** Читает файл-подмену с лимитом размера и кэшем по mtime */
  async readReplacementFile(path: string): Promise<Buffer> {
    const info = await stat(path)
    if (info.size > MAX_REPLACEMENT_FILE_BYTES) {
      throw new Error(`файл ${info.size} Б превышает лимит ${MAX_REPLACEMENT_FILE_BYTES} Б`)
    }
    const cached = this.replacementCache.get(path)
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.body

    const body = await readFile(path)
    this.replacementCache.set(path, { mtimeMs: info.mtimeMs, size: info.size, body })
    return body
  }

  private reloadIfChanged(): void {
    const now = Date.now()
    if (now - this.lastMtimeCheck < RULES_MTIME_CHECK_INTERVAL_MS) return
    this.lastMtimeCheck = now
    try {
      if (statSync(this.rulesFilePath).mtimeMs === this.lastMtimeMs) return
    } catch (err) {
      this.warn(`rules.json недоступен: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    // при неудаче остаются прежние правила — матчим по последнему валидному набору
    this.reload('не удалось перечитать rules.json')
  }

  private reload(context: string): void {
    try {
      const mtimeMs = statSync(this.rulesFilePath).mtimeMs
      const parsed = JSON.parse(readFileSync(this.rulesFilePath, 'utf-8')) as { rules?: unknown }
      if (!Array.isArray(parsed.rules)) throw new Error('"rules" должен быть списком')
      for (const rule of parsed.rules) {
        if (typeof rule !== 'object' || rule === null) throw new Error('правило должно быть объектом')
      }
      this.lastMtimeMs = mtimeMs
      this.rebuildIndex(parsed.rules as Rule[])
      if (this.lastReloadError !== null) {
        this.lastReloadError = null
        this.warn('rules.json снова читается, правила обновлены')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message !== this.lastReloadError) {
        this.lastReloadError = message
        this.warn(`${context}: ${message}. Прежние правила остаются активными.`)
      }
    }
  }

  private rebuildIndex(rules: Rule[]): void {
    const exact = new Map<string, Rule>()
    const regexRules: { rule: Rule; regex: RegExp }[] = []
    for (const rule of rules) {
      if (!rule.enabled) continue
      if (!rule.urlPattern) {
        this.warn(`правило ${rule.id} пропущено: пустой urlPattern`)
        continue
      }
      if (!rule.isRegex) {
        // первое правило с данным точным URL выигрывает — как и при линейном проходе
        if (!exact.has(rule.urlPattern)) exact.set(rule.urlPattern, rule)
        continue
      }
      const unsafeReason = unsafeRegexReason(rule.urlPattern)
      if (unsafeReason) {
        this.warn(`небезопасный regex в правиле ${rule.id}: ${unsafeReason}`)
        continue
      }
      try {
        regexRules.push({ rule, regex: new RegExp(rule.urlPattern) })
      } catch (err) {
        this.warn(`некорректный regex в правиле ${rule.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    this.exactRules = exact
    this.regexRules = regexRules
  }
}
