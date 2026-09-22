import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

/** Читает JSON-файл; при отсутствии возвращает fallback молча (нормальный случай — файл ещё не создан).
 * При повреждении тоже возвращает fallback, но дополнительно логирует и, если передан onCorrupted,
 * вызывает его — вызывающий код (например rulesStore) может показать это пользователю, а не только в консоль. */
export function readJsonFile<T>(filePath: string, fallback: T, onCorrupted?: (message: string) => void): T {
  if (!existsSync(filePath)) return fallback
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${filePath} повреждён или недоступен: ${message}`)
    onCorrupted?.(message)
    return fallback
  }
}

/** Записывает данные в JSON-файл с отступом в 2 пробела атомарно: сперва во временный файл рядом,
 * затем rename поверх целевого — rename на той же файловой системе атомарен на POSIX, поэтому
 * при падении/убийстве процесса посреди записи целевой файл остаётся либо старым, либо новым целиком,
 * никогда не оказывается наполовину записанным JSON */
export function writeJsonFile(filePath: string, data: unknown): void {
  const tmpPath = join(dirname(filePath), `.${Date.now()}-${process.pid}.tmp`)
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    renameSync(tmpPath, filePath)
  } catch (err) {
    // rename упал (например целевой файл заблокирован на Windows) — без подчистки временный
    // файл оставался бы мусором в userData при каждой такой неудаче
    try {
      rmSync(tmpPath, { force: true })
    } catch {
      // исходная ошибка важнее неудачи подчистки
    }
    throw err
  }
}
