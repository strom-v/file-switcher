import { tsToDate } from './formatters'
import type { ProxyLogEvent } from '../shared/types'

const CSV_COLUMNS = ['time', 'method', 'url', 'status', 'event', 'file', 'responseSize'] as const

/** Экранирует значение для CSV-ячейки (кавычки вокруг значений с запятой/кавычкой/переносом строки) */
function toCsvCell(value: string | number): string {
  const text = String(value)
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function toCsvRow(event: ProxyLogEvent): string {
  const cells: (string | number)[] = [
    tsToDate(event.ts).toISOString(),
    event.method,
    event.url,
    event.statusCode ?? '',
    event.event,
    event.file,
    event.responseSize
  ]
  return cells.map(toCsvCell).join(',')
}

/** Логи прокси → CSV с заголовком, читаемый в Excel/Numbers/Google Sheets */
export function buildCsv(logs: ProxyLogEvent[]): string {
  const header = CSV_COLUMNS.join(',')
  const rows = logs.map(toCsvRow)
  return [header, ...rows].join('\n')
}
