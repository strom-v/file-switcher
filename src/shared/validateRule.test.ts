import { describe, expect, it } from 'vitest'
import { assertRuleMatchesSchema, isValidRuleArray } from './validateRule'

const validRule = {
  id: 'r1',
  enabled: true,
  urlPattern: 'https://api.example.com/data',
  isRegex: false
}

describe('assertRuleMatchesSchema', () => {
  it('пропускает минимально валидное правило', () => {
    expect(() => assertRuleMatchesSchema(validRule)).not.toThrow()
  })

  it('пропускает правило со всеми опциональными полями', () => {
    expect(() =>
      assertRuleMatchesSchema({
        ...validRule,
        isRegex: true,
        group: 'api',
        localFilePath: '/tmp/mock.json',
        contentType: 'application/json',
        responseHeaderOverrides: [{ name: 'X-Test', value: '1' }],
        delayMs: 500,
        statusCodeOverride: 503
      })
    ).not.toThrow()
  })

  it('пропускает явный undefined в опциональном поле (форма шлёт его при смене вида подмены)', () => {
    expect(() =>
      assertRuleMatchesSchema({ ...validRule, responseBody: undefined, contentType: undefined })
    ).not.toThrow()
  })

  it('отклоняет отсутствующее обязательное поле', () => {
    const { enabled: _enabled, ...withoutEnabled } = validRule
    expect(() => assertRuleMatchesSchema(withoutEnabled)).toThrow(/enabled/)
  })

  it('отклоняет enabled не-boolean (строка вместо флага)', () => {
    expect(() => assertRuleMatchesSchema({ ...validRule, enabled: 'true' })).toThrow(/enabled.*boolean/)
  })

  it('отклоняет неизвестное поле', () => {
    expect(() => assertRuleMatchesSchema({ ...validRule, typpo: 1 })).toThrow(/typpo/)
  })

  it('отклоняет delayMs вне диапазона', () => {
    expect(() => assertRuleMatchesSchema({ ...validRule, delayMs: 60_001 })).toThrow(/максимум 60000/)
  })

  it('отклоняет statusCodeOverride не-integer', () => {
    expect(() => assertRuleMatchesSchema({ ...validRule, statusCodeOverride: 200.5 })).toThrow(/integer/)
  })

  it('отклоняет headerOverride с числовым value', () => {
    expect(() => assertRuleMatchesSchema({ ...validRule, responseHeaderOverrides: [{ name: 'X', value: 1 }] })).toThrow(
      /value.*string/
    )
  })
})

describe('isValidRuleArray', () => {
  it('true для массива валидных правил', () => {
    expect(isValidRuleArray([validRule, { ...validRule, id: 'r2' }])).toBe(true)
  })

  it('false, если хотя бы одно правило не проходит схему', () => {
    expect(isValidRuleArray([validRule, { id: 'r2', urlPattern: 'https://x' }])).toBe(false)
  })

  it('false для не-массива (например {"rules":{}} по ошибке)', () => {
    expect(isValidRuleArray({})).toBe(false)
  })
})
