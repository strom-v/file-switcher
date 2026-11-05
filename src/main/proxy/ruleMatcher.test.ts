import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { unsafeRegexReason } from '../../shared/regexSafety'
import type { Rule } from '../../shared/types'
import { applyHeaderOverrides, MAX_REGEX_URL_LENGTH, resolveSubstitutedPath, RuleMatcher } from './ruleMatcher'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'fs-matcher-'))
}

function makeMatcher(rules: Partial<Rule>[]): { matcher: RuleMatcher; warnings: string[] } {
  const rulesFile = join(tempDir(), 'rules.json')
  writeFileSync(rulesFile, JSON.stringify({ rules }))
  const warnings: string[] = []
  return { matcher: new RuleMatcher(rulesFile, (message) => warnings.push(message)), warnings }
}

function regexGroups(pattern: string, input: string): RegExpExecArray {
  const groups = new RegExp(pattern).exec(input)
  if (!groups) throw new Error('regex не совпал')
  return groups
}

describe('RuleMatcher.match', () => {
  it('точный URL совпадает только целиком', () => {
    const { matcher } = makeMatcher([{ id: 'a', enabled: true, urlPattern: 'https://x.com/a', isRegex: false }])
    expect(matcher.match('https://x.com/a')?.rule.id).toBe('a')
    expect(matcher.match('https://x.com/a')?.groups).toBeNull()
    expect(matcher.match('https://x.com/a/b')).toBeNull()
  })

  it('regex сохраняет группы для $N', () => {
    const { matcher } = makeMatcher([
      { id: 'a', enabled: true, urlPattern: '^https://x\\.com/api/(v\\d+)/(items|users)$', isRegex: true }
    ])
    const match = matcher.match('https://x.com/api/v2/items')
    expect(match?.rule.id).toBe('a')
    expect(match?.groups?.slice(1)).toEqual(['v2', 'items'])
  })

  it('пропускает небезопасные, битые, выключенные и пустые правила', () => {
    const { matcher, warnings } = makeMatcher([
      { id: 'nested', enabled: true, urlPattern: '^(a+)+$', isRegex: true },
      { id: 'bad', enabled: true, urlPattern: '[unclosed', isRegex: true },
      { id: 'off', enabled: false, urlPattern: '/ok', isRegex: true },
      { id: 'empty', enabled: true, urlPattern: '', isRegex: false },
      { id: 'good', enabled: true, urlPattern: '/ok$', isRegex: true }
    ])
    expect(matcher.match('https://x.com/ok')?.rule.id).toBe('good')
    expect(matcher.match('aaaa')).toBeNull()
    expect(warnings).toHaveLength(3)
  })

  it('первое подходящее regex-правило выигрывает', () => {
    const { matcher } = makeMatcher([
      { id: 'first', enabled: true, urlPattern: '/api', isRegex: true },
      { id: 'second', enabled: true, urlPattern: '/api/v2', isRegex: true }
    ])
    expect(matcher.match('https://x.com/api/v2/x')?.rule.id).toBe('first')
  })

  it('не гоняет regex по слишком длинному URL', () => {
    const { matcher } = makeMatcher([{ id: 'a', enabled: true, urlPattern: '/ok$', isRegex: true }])
    expect(matcher.match('x'.repeat(MAX_REGEX_URL_LENGTH) + '/ok')).toBeNull()
  })
})

describe('unsafeRegexReason', () => {
  it.each(['^https://x\\.com/api/(v\\d+)/(items|users)$', '/files/(?<name>[^/]+)\\.js', '.*\\.js$', 'a{2,3}b+?'])(
    'пропускает %s',
    (pattern) => {
      expect(unsafeRegexReason(pattern)).toBeNull()
    }
  )

  it.each(['^(a+)+$', '^(a|aa)+$', '.*x.*', '(a)\\1', '(?<n>a)\\k<n>', '(?=a)', '(?<=a)b', 'a'.repeat(2049)])(
    'отклоняет %s',
    (pattern) => {
      expect(unsafeRegexReason(pattern)).not.toBeNull()
    }
  )
})

describe('resolveSubstitutedPath', () => {
  it('разрешает вложенный относительный путь внутри базового каталога', () => {
    const base = tempDir()
    mkdirSync(join(base, 'api'))
    writeFileSync(join(base, 'api', 'users.json'), '{}')
    const resolved = resolveSubstitutedPath(join(base, '$1'), regexGroups('/files/(.+)', '/files/api/users.json'))
    expect(resolved.endsWith(join('api', 'users.json'))).toBe(true)
  })

  it('отклоняет выход через .., абсолютный путь и symlink', () => {
    const root = tempDir()
    const base = join(root, 'fixtures')
    mkdirSync(base)
    mkdirSync(join(root, 'outside'))
    writeFileSync(join(root, 'outside', 'secret.txt'), 'x')
    symlinkSync(join(root, 'outside'), join(base, 'link'))

    expect(() => resolveSubstitutedPath(join(base, '$1'), regexGroups('/files/(.+)', '/files/../x'))).toThrow()
    expect(() => resolveSubstitutedPath(join(base, '$1'), regexGroups('/files(.+)', '/files/etc/hosts'))).toThrow()
    expect(() =>
      resolveSubstitutedPath(join(base, '$1'), regexGroups('/files/(.+)', '/files/link/secret.txt'))
    ).toThrow()
  })
})

describe('applyHeaderOverrides', () => {
  it('заменяет без учёта регистра и удаляет при пустом значении', () => {
    const headers: [string, string][] = [
      ['X-Old', 'keep'],
      ['x-gone', '1'],
      ['X-Replace', 'old']
    ]
    applyHeaderOverrides(headers, [
      { name: 'X-Gone', value: '' },
      { name: 'x-replace', value: 'new' },
      { name: 'X-New', value: 'added' }
    ])
    expect(headers).toEqual([
      ['X-Old', 'keep'],
      ['x-replace', 'new'],
      ['X-New', 'added']
    ])
  })
})
