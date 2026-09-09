import { describe, expect, it } from 'vitest'
import { formatHeaders, formatSize, tryParseJson, tsToDate } from './formatters'

describe('tsToDate', () => {
  it('переводит unix-секунды в Date', () => {
    expect(tsToDate(1_700_000_000).getTime()).toBe(1_700_000_000_000)
  })
})

describe('formatHeaders', () => {
  it('многострочный key: value', () => {
    expect(formatHeaders({ 'Content-Type': 'application/json', 'X-Id': '42' })).toBe(
      'Content-Type: application/json\nX-Id: 42'
    )
  })
  it('тире для пустого объекта', () => {
    expect(formatHeaders({})).toBe('—')
  })
})

describe('formatSize', () => {
  it('байты / КБ / МБ', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})

describe('tryParseJson', () => {
  it('ok:true с разобранным значением', () => {
    expect(tryParseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    expect(tryParseJson('null')).toEqual({ ok: true, value: null })
  })
  it('ok:false для не-JSON', () => {
    expect(tryParseJson('не json')).toEqual({ ok: false })
  })
  it('ok:false для текста длиннее лимита (2 МБ) — не парсим', () => {
    expect(tryParseJson('"' + 'x'.repeat(2 * 1024 * 1024) + '"')).toEqual({ ok: false })
  })
})
