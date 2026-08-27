import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { readJsonFile, writeJsonFile } from './jsonFile'
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
    const parsed = readJsonFile<Partial<RulesFile>>(this.filePath, {})
    return { rules: parsed.rules ?? [] }
  }

  private write(data: RulesFile): void {
    writeJsonFile(this.filePath, data)
  }
}

export const rulesStore = new RulesStore()
