import { existsSync } from 'fs'
import { join } from 'path'
import { EventEmitter } from 'events'
import { app } from 'electron'
import { readJsonFile, writeJsonFile } from './jsonFile'
import { initialGroupForRule } from '../shared/ruleGroups'
import type { Rule } from '../shared/types'

export type { Rule } from '../shared/types'

interface RulesFile {
  rules: Rule[]
}

/** Бросает понятную ошибку, если у правила пустой urlPattern или (при isRegex) невалидный regex —
 * иначе такое правило молча не срабатывает, а причина видна только в stdout Python-аддона */
function assertValidRule(rule: Rule): void {
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
