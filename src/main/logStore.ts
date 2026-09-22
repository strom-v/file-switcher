import { closeSync, mkdirSync, openSync, readdirSync, readSync, rmSync, writeSync } from 'fs'
import { open as openFile } from 'fs/promises'
import type { FileHandle } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import type { LogEntryMeta, ProxyLogEvent } from '../shared/types'

// сколько последних записей отдаём в renderer при первичной загрузке — это лимит ОТОБРАЖЕНИЯ,
// не хранения: на диске лежит весь лог сессии
const RECENT_LIMIT = 2000

// потолок размера файла сессии — лог содержит тела и (частично) заголовки всего трафика и растёт
// без предела на активной сессии; после потолка новые записи в файл не пишутся (в renderer идут
// по-прежнему), пользователь видит предупреждение один раз
const MAX_SESSION_FILE_BYTES = 100 * 1024 * 1024 // 100 МБ

// сколько файлов прошлых сессий держим на диске — файл лога содержит секреты (см. addon.py:
// заголовки редактируются, но URL и тела остаются), незачем копить их бесконечно
const KEEP_SESSION_FILES = 20

// потолок индекса в памяти (~200 байт на запись): на очень длинной сессии за чатливым приложением
// счёт идёт на сотни тысяч запросов. После потолка самые старые записи выпадают из индекса —
// список/поиск их больше не видят, но файл сессии всё равно ограничен MAX_SESSION_FILE_BYTES
const MAX_INDEX_ENTRIES = 200_000

const SESSION_FILE_RE = /^traffic-\d+\.jsonl$/

/** Запись индекса в памяти: лёгкие поля для списка/поиска + положение полной строки в файле,
 * чтобы getEvent читал одну строку, а не парсил весь файл */
interface IndexEntry extends LogEntryMeta {
  byteOffset: number
  byteLength: number
}

/** Копирует только лёгкие поля записи (для списка) — и из полного события, и из записи индекса
 * (обе структурно содержат поля LogEntryMeta), отбрасывая тела/заголовки и служебные смещения */
function toMeta(entry: LogEntryMeta): LogEntryMeta {
  return {
    event: entry.event,
    url: entry.url,
    file: entry.file,
    method: entry.method,
    statusCode: entry.statusCode,
    responseSize: entry.responseSize,
    ts: entry.ts,
    requestBodyIsBinary: entry.requestBodyIsBinary,
    requestBodySize: entry.requestBodySize,
    responseBodyIsBinary: entry.responseBodyIsBinary
  }
}

/**
 * Хранилище лога трафика: полные события пишутся построчным JSON (JSONL) в файл сессии, в памяти
 * держится лёгкий индекс (метаданные + положение строки в файле). Тело события читается из файла
 * по смещению — одна строка, без парсинга всего файла. Каждый запуск приложения — новый файл
 * traffic-<timestamp>.jsonl; при старте удаляются все, кроме KEEP_SESSION_FILES последних. Файл
 * сессии перестаёт расти после MAX_SESSION_FILE_BYTES. Кнопка «очистить» в UI чистит только
 * отображение в renderer — файл на диске остаётся.
 */
class LogStore {
  private readonly dir = join(app.getPath('userData'), 'traffic-logs')
  private readonly filePath = join(this.dir, `traffic-${Date.now()}.jsonl`)
  // дескриптор файла на запись держим открытым: writeSync пишет синхронно и сразу на диск,
  // поэтому byteOffset из индекса всегда валиден для чтения в getEvent (в отличие от буферизованного
  // WriteStream, где только что записанная строка могла ещё не долететь до файла)
  private writeFd: number | null = null
  private bytesWritten = 0
  // потолок размера файла достигнут — постоянное состояние сессии (в файл больше не пишем)
  private sizeLimitReached = false
  // предупреждение о потолке уже ушло в renderer — больше не повторяем за сессию
  private sizeLimitWarned = false
  // после ошибки файловой системы запись больше не возобновляем в этой сессии, чтобы каждый
  // следующий proxy-event не повторял тот же сбой; текст предупреждения renderer забирает один раз
  private diskLoggingError: string | null = null
  private diskLoggingWarning: string | null = null
  // индекс записей (последние MAX_INDEX_ENTRIES): метаданные + смещение/длина строки в файле
  private index: IndexEntry[] = []
  // новый поиск отменяет предыдущий между асинхронными чтениями строк
  private searchGeneration = 0

  constructor() {
    this.pruneOldSessionFiles()
  }

  /** Удаляет файлы прошлых сессий, кроме KEEP_SESSION_FILES самых свежих (по имени = по времени старта) */
  private pruneOldSessionFiles(): void {
    let names: string[]
    try {
      names = readdirSync(this.dir).filter((name) => SESSION_FILE_RE.test(name))
    } catch {
      // папки ещё нет — чистить нечего
      return
    }
    const stale = names.sort().slice(0, Math.max(0, names.length - KEEP_SESSION_FILES))
    for (const name of stale) {
      try {
        rmSync(join(this.dir, name), { force: true })
      } catch {
        // не удалось удалить один файл — не критично, продолжаем
      }
    }
  }

  private ensureWriteFd(): number {
    if (this.writeFd === null) {
      mkdirSync(this.dir, { recursive: true })
      this.writeFd = openSync(this.filePath, 'a')
    }
    return this.writeFd
  }

  /** Пишет строку целиком (writeSync может записать не всё за раз) — иначе byteOffset в индексе
   * разъедется с реальным содержимым файла */
  private writeLine(line: string): void {
    const buf = Buffer.from(line, 'utf-8')
    let written = 0
    while (written < buf.length) {
      const chunkSize = writeSync(this.ensureWriteFd(), buf, written)
      if (chunkSize === 0) throw new Error('Файловая система не записала данные')
      written += chunkSize
    }
  }

  /** Отключает запись на диск после первой ошибки файловой системы */
  private disableDiskLogging(error: unknown): void {
    if (this.diskLoggingError) return
    const message = error instanceof Error ? error.message : String(error)
    this.diskLoggingError = message
    this.diskLoggingWarning = `Запись traffic-log на диск отключена: ${message}`
    if (this.writeFd !== null) {
      try {
        closeSync(this.writeFd)
      } catch {
        // исходная ошибка записи важнее ошибки закрытия уже неисправного дескриптора
      }
      this.writeFd = null
    }
  }

  /** true один раз за сессию — в момент, когда файл впервые упёрся в потолок размера */
  consumeSizeLimitWarning(): boolean {
    if (!this.sizeLimitReached || this.sizeLimitWarned) return false
    this.sizeLimitWarned = true
    return true
  }

  /** Возвращает предупреждение об отключении дискового лога только один раз */
  consumeDiskLoggingWarning(): string | null {
    const warning = this.diskLoggingWarning
    this.diskLoggingWarning = null
    return warning
  }

  /** Дописывает пачку событий в файл, возвращает их лёгкие версии для отправки в renderer.
   * Индекс/renderer получают все записи; в файл запись прекращается после MAX_SESSION_FILE_BYTES
   * (тогда byteLength = 0 — событие есть в списке, но тела на диске нет). */
  appendBatch(events: ProxyLogEvent[]): LogEntryMeta[] {
    if (events.length === 0) return []

    // сериализуем всю пачку и один раз записываем на диск — раньше был writeSync на каждое событие
    // (500-1000 синхронных записей/с блокировали main); порядок и byteOffset при этом сохраняются
    const lines = events.map((event) => `${JSON.stringify(event)}\n`)
    const lineByteLengths = lines.map((line) => Buffer.byteLength(line, 'utf-8'))
    const writeStartOffset = this.bytesWritten
    let writtenInBatch = 0

    if (!this.diskLoggingError) {
      const toWrite: string[] = []
      for (let i = 0; i < lines.length; i++) {
        if (writeStartOffset + writtenInBatch + lineByteLengths[i] <= MAX_SESSION_FILE_BYTES) {
          toWrite.push(lines[i])
          writtenInBatch += lineByteLengths[i]
        } else {
          // потолок размера: остаток пачки уходит в renderer, но на диск уже не пишется
          this.sizeLimitReached = true
          break
        }
      }
      if (toWrite.length > 0) {
        try {
          this.writeLine(toWrite.join(''))
          this.bytesWritten += writtenInBatch
        } catch (error) {
          this.disableDiskLogging(error)
          writtenInBatch = 0
        }
      }
    }

    const metas: LogEntryMeta[] = []
    let offsetCursor = writeStartOffset
    for (let i = 0; i < events.length; i++) {
      // byteLength 0 = строка в файл не попала (потолок размера или ошибка диска); getEvent вернёт null
      const onDisk = offsetCursor + lineByteLengths[i] <= writeStartOffset + writtenInBatch
      const byteOffset = onDisk ? offsetCursor : 0
      const byteLength = onDisk ? lineByteLengths[i] : 0
      if (onDisk) offsetCursor += lineByteLengths[i]

      const entry: IndexEntry = { ...toMeta(events[i]), byteOffset, byteLength }
      this.index.push(entry)
      metas.push(toMeta(entry))
    }
    if (this.index.length > MAX_INDEX_ENTRIES) {
      this.index.splice(0, this.index.length - MAX_INDEX_ENTRIES)
    }
    return metas
  }

  /** Полное событие с этим ts — читает одну строку из файла по смещению из индекса */
  getEvent(ts: number): ProxyLogEvent | null {
    const entry = this.index.find((e) => e.ts === ts)
    if (!entry || entry.byteLength === 0) return null
    try {
      const fd = openSync(this.filePath, 'r')
      try {
        const buf = Buffer.allocUnsafe(entry.byteLength)
        // одиночный readSync не гарантирует полное чтение — при частичном JSON.parse получал бы
        // урезанную строку и молча возвращал null, хотя запись в файле цела
        let bytesRead = 0
        while (bytesRead < entry.byteLength) {
          const n = readSync(fd, buf, bytesRead, entry.byteLength - bytesRead, entry.byteOffset + bytesRead)
          if (n === 0) return null
          bytesRead += n
        }
        return JSON.parse(buf.toString('utf-8')) as ProxyLogEvent
      } finally {
        closeSync(fd)
      }
    } catch {
      return null
    }
  }

  /** Путь к append-only JSONL текущей сессии для потокового экспорта */
  getFilePath(): string {
    return this.filePath
  }

  /** true, если в сессии есть хоть одна записанная на диск строка — для доступности кнопки экспорта.
   * Не завязано на renderer-список: тот чистится кнопкой «очистить», а файл сессии остаётся */
  hasExportableEvents(): boolean {
    return this.bytesWritten > 0
  }

  /** Последние записи для первичной отрисовки списка */
  getRecent(): LogEntryMeta[] {
    return this.index.slice(-RECENT_LIMIT).map(toMeta)
  }

  /** Метаданные записей, чьи url/method/тело содержат query (по телу — только с searchInBody) */
  async search(query: string, searchInBody: boolean): Promise<LogEntryMeta[]> {
    const generation = ++this.searchGeneration
    const q = query.trim().toLowerCase()
    if (!q) return this.getRecent()

    // renderer хранит только RECENT_LIMIT последних записей; более старые совпадения нельзя
    // показать, поэтому не читаем и не отправляем их через IPC
    const searchable = this.index.slice(-RECENT_LIMIT)

    const matchedTs = new Set(
      searchable
        .filter((m) => m.url.toLowerCase().includes(q) || (m.event === 'matched' && m.file.toLowerCase().includes(q)))
        .map((m) => m.ts)
    )

    if (searchInBody) {
      let file: FileHandle | null = null
      try {
        file = await openFile(this.filePath, 'r')
        for (const entry of searchable) {
          if (generation !== this.searchGeneration) return []
          if (matchedTs.has(entry.ts) || entry.byteLength === 0) continue
          const event = await this.readIndexedEvent(file, entry)
          // запись на диске может быть от старой версии формата без тел — null-safe доступ,
          // иначе один TypeError обрывал бы поиск по телу для всех остальных записей
          const requestBody = typeof event?.requestBody === 'string' ? event.requestBody.toLowerCase() : ''
          const responseBody = typeof event?.responseBody === 'string' ? event.responseBody.toLowerCase() : ''
          if (requestBody.includes(q) || responseBody.includes(q)) {
            matchedTs.add(entry.ts)
          }
        }
      } catch {
        // файл мог стать недоступен после ошибки диска; совпадения по метаданным всё равно валидны
      } finally {
        await file?.close().catch(() => undefined)
      }
    }

    if (generation !== this.searchGeneration) return []
    return searchable.filter((m) => matchedTs.has(m.ts)).map(toMeta)
  }

  /** Асинхронно читает одну индексированную JSONL-запись без блокировки main-потока */
  private async readIndexedEvent(file: FileHandle, entry: IndexEntry): Promise<ProxyLogEvent | null> {
    const buffer = Buffer.allocUnsafe(entry.byteLength)
    let bytesRead = 0
    while (bytesRead < buffer.length) {
      const result = await file.read(buffer, bytesRead, buffer.length - bytesRead, entry.byteOffset + bytesRead)
      if (result.bytesRead === 0) return null
      bytesRead += result.bytesRead
    }
    try {
      return JSON.parse(buffer.toString('utf-8')) as ProxyLogEvent
    } catch {
      return null
    }
  }
}

export const logStore = new LogStore()
