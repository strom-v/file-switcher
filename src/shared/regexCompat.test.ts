import { describe, expect, it } from 'vitest'
import { pythonRegexIncompatibility } from './regexCompat'

describe('pythonRegexIncompatibility', () => {
  it('пропускает совместимый поднабор', () => {
    for (const pattern of [
      '^https://api\\.example\\.com/(v\\d+)/(items|users)$',
      '/files/(?P<name>.+)\\.json',
      '(?P<a>x)(?P=a)',
      '[A-Za-z0-9_-]+',
      'https://.*\\.corp/api\\?id=\\d{1,8}'
    ]) {
      expect(pythonRegexIncompatibility(pattern)).toBeNull()
    }
  })

  it('отклоняет JS-style именованную группу (?<name>)', () => {
    expect(pythonRegexIncompatibility('/files/(?<name>.+)')).toMatch(/\(\?P<name>/)
  })

  it('не путает lookbehind (?<= / (?<! с именованной группой', () => {
    expect(pythonRegexIncompatibility('(?<=/api/)\\w+')).toBeNull()
    expect(pythonRegexIncompatibility('(?<!x)y')).toBeNull()
  })

  it('отклоняет JS-style обратную ссылку \\k<name>', () => {
    expect(pythonRegexIncompatibility('(?P<a>x)\\k<a>')).toMatch(/\(\?P=name\)/)
  })

  it('отклоняет Unicode property escape \\p{...}', () => {
    expect(pythonRegexIncompatibility('\\p{L}+')).toMatch(/property escapes/)
  })
})
