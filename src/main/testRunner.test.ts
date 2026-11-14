import { describe, it, expect } from 'vitest'
import { parseVitestList } from './testRunner'

describe('parseVitestList', () => {
  it('разбирает строки "file > describe > тест" в TestCase', () => {
    const stdout = [
      'src/shared/ruleGroups.test.ts > groupKeyOf > возвращает группу как есть',
      'src/shared/ruleGroups.test.ts > groupKeyOf > нормализует undefined',
      'src/main/logStore.test.ts > logStore.search > по url'
    ].join('\n')

    const cases = parseVitestList(stdout)

    expect(cases).toHaveLength(3)
    expect(cases[0]).toEqual({
      id: 'src/shared/ruleGroups.test.ts::groupKeyOf > возвращает группу как есть',
      file: 'src/shared/ruleGroups.test.ts',
      fullName: 'groupKeyOf > возвращает группу как есть',
      title: 'возвращает группу как есть'
    })
  })

  it('пропускает строки без разделителя и файлы, не являющиеся тестами', () => {
    const stdout = [
      'src/foo.ts > bar > baz',
      'какая-то посторонняя строка',
      'src/main/logStore.test.ts > search > по url'
    ].join('\n')

    const cases = parseVitestList(stdout)

    expect(cases).toHaveLength(1)
    expect(cases[0].file).toBe('src/main/logStore.test.ts')
  })
})
