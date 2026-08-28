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
// JSON.parse на многомегабайтном тексте синхронно блокирует UI-поток на заметное время, а результат
// всё равно нечитаем для человека при такой длине (что в плоском виде с отступами, что деревом)
const FORMAT_JSON_MAX_LENGTH = 2 * 1024 * 1024 // 2 МБ

/** Пытается разобрать текст как JSON; ok:false означает "не JSON или текст длиннее лимита"
 * (для лимита разбор просто не делается, а не молча режется на середине структуры). Отдельное
 * поле ok, а не просто null при неудаче — валидный JSON-текст "null" тоже парсится в null,
 * и его нельзя было бы отличить от ошибки парсинга. */
export function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text.length > FORMAT_JSON_MAX_LENGTH) return { ok: false }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}
