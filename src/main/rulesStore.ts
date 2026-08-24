import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { Rule } from '../shared/types'

export type { Rule } from '../shared/types'

interface RulesFile {
  rules: Rule[]
}

/** Хранит и персистит правила подмены в userData/rules.json */
export class RulesStore {
  private readonly filePath: string

  constructor(filePath: string = join(app.getPath('userData'), 'rules.json')) {
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
    this.write({ rules })
    return rules
  }

  private read(): RulesFile {
    try {
      const raw = readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as RulesFile
      return { rules: parsed.rules ?? [] }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`rules.json повреждён или недоступен (${this.filePath}): ${message}`)
      return { rules: [] }
    }
  }

  private write(data: RulesFile): void {
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8')
  }
}

export const rulesStore = new RulesStore()
