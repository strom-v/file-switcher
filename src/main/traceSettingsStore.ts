import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { readJsonFile, writeJsonFile } from './jsonFile'
import type { TrafficCaptureSettings } from '../shared/types'

const DEFAULT_SETTINGS: TrafficCaptureSettings = {
  captureRequestBody: false,
  captureResponseBody: false
}

/** Хранит и персистит настройки захвата тела запросов/ответов в userData/trace-settings.json;
 * addon.py перечитывает этот файл по mtime так же, как rules.json */
export class TraceSettingsStore {
  private readonly filePath: string

  constructor(filePath: string = join(app.getPath('userData'), 'trace-settings.json')) {
    this.filePath = filePath
    if (!existsSync(this.filePath)) {
      this.write(DEFAULT_SETTINGS)
    }
  }

  getFilePath(): string {
    return this.filePath
  }

  get(): TrafficCaptureSettings {
    return readJsonFile<TrafficCaptureSettings>(this.filePath, DEFAULT_SETTINGS)
  }

  save(settings: TrafficCaptureSettings): TrafficCaptureSettings {
    this.write(settings)
    return settings
  }

  private write(data: TrafficCaptureSettings): void {
    writeJsonFile(this.filePath, data)
  }
}

export const traceSettingsStore = new TraceSettingsStore()
