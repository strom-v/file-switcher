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
