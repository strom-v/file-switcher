import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import schema from './rule.schema.json'

/** Имена полей интерфейса `interface Rule { ... }` из исходника types.ts (без парсера TS — простой разбор блока) */
function ruleInterfaceFields(): string[] {
  const src = readFileSync(join(__dirname, 'types.ts'), 'utf-8')
  const block = src.match(/export interface Rule \{([\s\S]*?)\n\}/)
  if (!block) throw new Error('не найден interface Rule в types.ts')
  const fields: string[] = []
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*([a-zA-Z]+)\??:/)
    if (m) fields.push(m[1])
  }
  return fields
}

/** Имена полей headerOverride из `interface HeaderOverride` */
function headerOverrideFields(): string[] {
  const src = readFileSync(join(__dirname, 'types.ts'), 'utf-8')
  const block = src.match(/export interface HeaderOverride \{([\s\S]*?)\n\}/)!
  return [...block[1].matchAll(/^\s*([a-zA-Z]+)\??:/gm)].map((m) => m[1])
}

describe('rule.schema.json vs TS types', () => {
  it('набор полей схемы совпадает с interface Rule', () => {
    expect(Object.keys(schema.properties).sort()).toEqual(ruleInterfaceFields().sort())
  })

  it('обязательные поля схемы — это неопциональные поля interface Rule', () => {
    const src = readFileSync(join(__dirname, 'types.ts'), 'utf-8')
    const block = src.match(/export interface Rule \{([\s\S]*?)\n\}/)![1]
    const nonOptional = [...block.matchAll(/^\s*([a-zA-Z]+):/gm)].map((m) => m[1])
    expect(schema.required.sort()).toEqual(nonOptional.sort())
  })

  it('поля headerOverride в схеме совпадают с interface HeaderOverride', () => {
    expect(Object.keys(schema.definitions.headerOverride.properties).sort()).toEqual(headerOverrideFields().sort())
  })
})
