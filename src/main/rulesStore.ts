import { existsSync } from 'fs'
import { join } from 'path'
import { EventEmitter } from 'events'
import { app } from 'electron'
import { readJsonFile, writeJsonFile } from './jsonFile'
import { initialGroupForRule } from '../shared/ruleGroups'
import ruleSchema from '../shared/rule.schema.json'
import type { Rule } from '../shared/types'

export type { Rule } from '../shared/types'

interface RulesFile {
  rules: Rule[]
}

// допустимые ключи правила — из общей схемы (единый контракт с addon.py, см. rule.schema.json)
const ALLOWED_RULE_KEYS = new Set(Object.keys(ruleSchema.properties))

/** Бросает понятную ошибку при невалидном правиле (пустой/битый urlPattern, невалидный JSON инлайн-тела,
 * delayMs/statusCodeOverride вне диапазона, заголовок с пустым именем) — иначе правило молча ведёт себя
 * не так, как написано, а причина видна только в stdout Python-аддона */
function assertValidRule(rule: Rule): void {
  const unknownKeys = Object.keys(rule).filter((key) => !ALLOWED_RULE_KEYS.has(key))
  if (unknownKeys.length > 0) {
    throw new Error(`Правило ${rule.id}: неизвестные поля ${unknownKeys.join(', ')} (опечатка?)`)
  }
  if (!rule.urlPattern?.trim()) {
    throw new Error(`Правило ${rule.id}: пустой URL-паттерн`)
  }
  if (rule.isRegex) {
    try {
      new RegExp(rule.urlPattern)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Правило ${rule.id}: некорректный regex "${rule.urlPattern}" — ${message}`)
    }
  }
  // инлайн-тело с JSON-типом должно быть валидным JSON — иначе клиент молча не разберёт ответ
  if (rule.responseBody && rule.contentType?.includes('json')) {
    try {
      JSON.parse(rule.responseBody)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Правило ${rule.id}: тело ответа не является валидным JSON — ${message}`)
    }
  }
  // поля "расширенных" модификаций правятся только вручную в rules.json / импортом — формы для них нет,
  // поэтому валидируем здесь: опечатка (delayMs: 60000 вместо 60) иначе молча ломает поведение
  if (rule.delayMs !== undefined && (!Number.isFinite(rule.delayMs) || rule.delayMs < 0 || rule.delayMs > 60_000)) {
    throw new Error(`Правило ${rule.id}: delayMs должен быть числом от 0 до 60000 мс`)
  }
  if (
    rule.statusCodeOverride !== undefined &&
    (!Number.isInteger(rule.statusCodeOverride) || rule.statusCodeOverride < 100 || rule.statusCodeOverride > 599)
  ) {
    throw new Error(`Правило ${rule.id}: statusCodeOverride должен быть целым числом от 100 до 599`)
  }
  for (const key of ['requestHeaderOverrides', 'responseHeaderOverrides'] as const) {
    for (const override of rule[key] ?? []) {
      if (typeof override?.name !== 'string' || !override.name.trim()) {
        throw new Error(`Правило ${rule.id}: в ${key} есть заголовок с пустым именем`)
      }
    }
  }
}

/** Хранит и персистит правила подмены в userData/rules.json.
 * Эмиттит 'corrupted', если файл существует, но не парсится как JSON — иначе потеря
 * правил была бы видна только в консоли main-процесса, недоступной пользователю GUI. */
export class RulesStore extends EventEmitter {
  private readonly filePath: string

  constructor(filePath: string = join(app.getPath('userData'), 'rules.json')) {
    super()
    this.filePath = filePath
    if (!existsSync(this.filePath)) {
      this.write({ rules: [] })
    }
  }

  getFilePath(): string {
    return this.filePath
  }

  getAll(): Rule[] {
    return this.read().rules
  }

  saveAll(rules: Rule[]): Rule[] {
    rules.forEach(assertValidRule)
    const normalized = withGroups(rules)
    this.write({ rules: normalized })
    return normalized
  }

  private read(): RulesFile {
    const parsed = readJsonFile<Partial<RulesFile>>(this.filePath, {}, (message) => {
      this.emit('corrupted', message)
    })
    const rules = parsed.rules ?? []
    // одноразовая миграция: правилам без явной группы проставляем её из пути подмены
    // (или "остальные"), чтобы дальше группировка шла только по Rule.group. Делаем в read(),
    // чтобы покрыть и импорт правил, и старый rules.json на диске
    const migrated = withGroups(rules)
    if (migrated !== rules) {
      this.write({ rules: migrated })
    }
    return { rules: migrated }
  }

  private write(data: RulesFile): void {
    writeJsonFile(this.filePath, data)
  }
}

/** Возвращает rules с проставленной группой у тех, где её нет; если менять нечего — тот же массив */
function withGroups(rules: Rule[]): Rule[] {
  if (rules.every((rule) => rule.group !== undefined)) {
    return rules
  }
  return rules.map((rule) => (rule.group === undefined ? { ...rule, group: initialGroupForRule(rule) } : rule))
}

export const rulesStore = new RulesStore()
