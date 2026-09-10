/**
 * Валидация правила подмены по rule.schema.json во время выполнения. Схема — канонический контракт
 * (та же для TS и Python), но JSON-payload из импорта и с диска раньше нигде по ней не проверялся:
 * правило без boolean enabled/isRegex «сохранялось успешно», а addon.py потом молча пропускал его.
 *
 * Реализован минимальный поднабор draft-07, которого хватает для этой схемы: type (включая integer),
 * required, additionalProperties: false, minimum/maximum, items + $ref на #/definitions/*.
 */
import ruleSchema from './rule.schema.json'
import type { Rule } from './types'

type JsonSchema = {
  type?: string
  required?: string[]
  additionalProperties?: boolean
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  minimum?: number
  maximum?: number
  $ref?: string
}

const definitions = (ruleSchema as { definitions: Record<string, JsonSchema> }).definitions

function resolveRef(schema: JsonSchema): JsonSchema {
  if (!schema.$ref) return schema
  const name = schema.$ref.replace('#/definitions/', '')
  const resolved = definitions[name]
  if (!resolved) throw new Error(`неизвестная ссылка схемы: ${schema.$ref}`)
  return resolved
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'array':
      return Array.isArray(value)
    case 'string':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    default:
      return false
  }
}

/** Собирает список ошибок (пустой — значение валидно). `path` — для читаемого адреса поля */
function collectErrors(value: unknown, rawSchema: JsonSchema, path: string): string[] {
  const schema = resolveRef(rawSchema)
  const errors: string[] = []
  const at = path || 'правило'

  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${at}: ожидался тип ${schema.type}`)
    return errors
  }

  if (schema.type === 'object') {
    const obj = value as Record<string, unknown>
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push(`${at}: отсутствует обязательное поле "${key}"`)
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(obj)) {
        if (!(key in schema.properties)) errors.push(`${at}: неизвестное поле "${key}" (опечатка?)`)
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      if (key in obj) errors.push(...collectErrors(obj[key], propSchema, path ? `${path}.${key}` : key))
    }
  }

  if (schema.type === 'array' && schema.items) {
    ;(value as unknown[]).forEach((item, index) => {
      errors.push(...collectErrors(item, schema.items as JsonSchema, `${at}[${index}]`))
    })
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: минимум ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: максимум ${schema.maximum}`)
  }

  return errors
}

/** Валидирует одно правило по схеме, бросает с путём к первому невалидному полю */
export function assertRuleMatchesSchema(value: unknown): asserts value is Rule {
  const errors = collectErrors(value, ruleSchema as JsonSchema, '')
  if (errors.length > 0) {
    const id = value && typeof value === 'object' && 'id' in value ? String((value as { id: unknown }).id) : '(без id)'
    throw new Error(`Правило ${id}: ${errors[0]}`)
  }
}

/** true, если разобранный JSON — массив правил, каждое из которых проходит схему */
export function isValidRuleArray(value: unknown): value is Rule[] {
  if (!Array.isArray(value)) return false
  try {
    for (const item of value) assertRuleMatchesSchema(item)
    return true
  } catch {
    return false
  }
}
