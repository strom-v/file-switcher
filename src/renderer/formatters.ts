/** Unix-время в секундах (как приходит от addon.py) → объект Date */
export function tsToDate(ts: number): Date {
  return new Date(ts * 1000)
}

/** HTTP-заголовки в виде многострочного "ключ: значение" текста для копируемого просмотра */
export function formatHeaders(headers: Record<string, string>): string {
  const entries = Object.entries(headers)
  if (entries.length === 0) return '—'
  return entries.map(([key, value]) => `${key}: ${value}`).join('\n')
}

/** Размер в байтах → человекочитаемая строка (B/KB/MB) */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// тело запроса/ответа логируется без лимита размера (см. AGENTS.md, "Известные ограничения") — но
// JSON.parse + JSON.stringify(..., null, 2) на многомегабайтном тексте синхронно блокирует UI-поток
// на заметное время, а результат всё равно нечитаем для человека при такой длине
const FORMAT_JSON_MAX_LENGTH = 2 * 1024 * 1024 // 2 МБ

/** Пытается разобрать текст как JSON и вернуть его в читаемом виде с отступами; если это не JSON
 * или текст длиннее лимита — null (для лимита форматирование просто не делается, а не молча режется) */
export function tryFormatJson(text: string): string | null {
  if (text.length > FORMAT_JSON_MAX_LENGTH) return null
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return null
  }
}
