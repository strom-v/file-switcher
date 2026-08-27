import { existsSync, readFileSync, writeFileSync } from 'fs'

/** Читает JSON-файл; при отсутствии или повреждении возвращает fallback и логирует ошибку (кроме отсутствия файла) */
export function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${filePath} повреждён или недоступен: ${message}`)
    return fallback
  }
}

/** Записывает данные в JSON-файл с отступом в 2 пробела */
export function writeJsonFile(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}
