import { existsSync } from 'fs'
import { join } from 'path'
import { EventEmitter } from 'events'
import { app } from 'electron'
import { readJsonFile, writeJsonFile } from './jsonFile'
import { initialGroupForRule } from '../shared/ruleGroups'
import { assertRuleMatchesSchema } from '../shared/validateRule'
import { pythonRegexIncompatibility } from '../shared/regexCompat'
import type { Rule } from '../shared/types'

export type { Rule } from '../shared/types'

interface RulesFile {
  rules: Rule[]
}

/** Бросает понятную ошибку при невалидном правиле (несоответствие схеме, пустой/битый urlPattern,
 * невалидный JSON инлайн-тела, delayMs/statusCodeOverride вне диапазона, заголовок с пустым именем) —
 * иначе правило молча ведёт себя не так, как написано, а причина видна только в stdout Python-аддона */
function assertValidRule(rule: unknown): asserts rule is Rule {
  // сначала форма по общей схеме: типы полей (boolean enabled/isRegex), обязательные поля,
  // неизвестные ключи, диапазоны delayMs/statusCodeOverride
  assertRuleMatchesSchema(rule)
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
    // regex исполняет Python re в addon.py — синтаксис двух движков расходится, отклоняем
    // JS-специфичные конструкции до сохранения, иначе правило молча не сработает в прокси
    const incompatibility = pythonRegexIncompatibility(rule.urlPattern)
    if (incompatibility) {
      throw new Error(`Правило ${rule.id}: regex несовместим с движком прокси — ${incompatibility}`)
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
      try {
        this.write({ rules: [] })
      } catch (err) {
        // userData недоступен для записи — не роняем main на этапе импорта модуля (иначе приложение
        // упало бы ещё до создания окна). Правила будут пустыми, а реальная ошибка покажется
        // пользователю при первой попытке сохранить (saveAll бросает её через IPC в renderer)
        const message = err instanceof Error ? err.message : String(err)
        console.error(`не удалось создать rules.json: ${message}`)
      }
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
    // валидный JSON, но не { rules: [...] } (например {"rules":{}}) — readJsonFile приводит его к типу
    // молча, а дальше withGroups звал бы .every() на объекте и падал уже на первом rules:get
    if (!Array.isArray(parsed.rules)) {
      if (parsed.rules !== undefined) {
        this.emit('corrupted', 'rules.json: поле "rules" не является массивом')
      }
      return { rules: [] }
    }
    const rules = parsed.rules
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
