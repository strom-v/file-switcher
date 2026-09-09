import { describe, expect, it } from 'vitest'
import { compareGroupNames, extractRepoFromPath, groupKeyOf, initialGroupForRule, OTHER_GROUP_KEY } from './ruleGroups'
import type { Rule } from './types'

function rule(patch: Partial<Rule>): Rule {
  return { id: 'r1', enabled: true, urlPattern: 'x', isRegex: false, ...patch }
}

describe('groupKeyOf', () => {
  it('возвращает группу как есть', () => {
    expect(groupKeyOf(rule({ group: 'billing' }))).toBe('billing')
  })
  it('нормализует undefined и пустую строку к OTHER_GROUP_KEY', () => {
    expect(groupKeyOf(rule({ group: undefined }))).toBe(OTHER_GROUP_KEY)
    expect(groupKeyOf(rule({ group: '' }))).toBe(OTHER_GROUP_KEY)
  })
})

describe('compareGroupNames', () => {
  it('латиница перед кириллицей', () => {
    expect(compareGroupNames('zeta', 'альфа')).toBeLessThan(0)
    expect(compareGroupNames('альфа', 'zeta')).toBeGreaterThan(0)
  })
  it('внутри одной письменности — по алфавиту', () => {
    expect(compareGroupNames('alpha', 'beta')).toBeLessThan(0)
    expect(compareGroupNames('яблоко', 'арбуз')).toBeGreaterThan(0)
  })
  it('сортировка массива стабильна и предсказуема', () => {
    expect(['яблоко', 'zeta', 'alpha', 'арбуз'].sort(compareGroupNames)).toEqual(['alpha', 'zeta', 'арбуз', 'яблоко'])
  })
})

describe('extractRepoFromPath', () => {
  it('достаёт репозиторий из .../projects/<org>/<repo>/...', () => {
    expect(extractRepoFromPath('/Users/x/projects/saby/money/client/a.js')).toBe('money')
  })
  it('null для пути без сегмента projects', () => {
    expect(extractRepoFromPath('/tmp/a/b.js')).toBeNull()
    expect(extractRepoFromPath(undefined)).toBeNull()
  })
  it('null, если после org нет вложенного файла (нет закрывающего слэша)', () => {
    expect(extractRepoFromPath('/x/projects/saby/money')).toBeNull()
  })
})

describe('initialGroupForRule', () => {
  it('группа из пути подмены', () => {
    expect(initialGroupForRule(rule({ localFilePath: '/x/projects/acme/web/app.js' }))).toBe('web')
  })
  it('OTHER_GROUP_KEY, если путь не даёт репозиторий', () => {
    expect(initialGroupForRule(rule({ localFilePath: '/tmp/a.js' }))).toBe(OTHER_GROUP_KEY)
    expect(initialGroupForRule(rule({ localFilePath: undefined }))).toBe(OTHER_GROUP_KEY)
  })
})
