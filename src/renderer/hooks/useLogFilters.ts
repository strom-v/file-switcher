import { useState } from 'react'
import type { ProxyLogEventType } from '../../shared/types'

export const EVENT_FILTER_ALL = 'all' as const
export type EventFilter = ProxyLogEventType | typeof EVENT_FILTER_ALL

const EVENT_FILTER_STORAGE_KEY = 'file-switcher:log-event-filter'

function readStoredEventFilter(): EventFilter {
  const stored = localStorage.getItem(EVENT_FILTER_STORAGE_KEY)
  return stored === 'matched' ? 'matched' : EVENT_FILTER_ALL
}

/** Фильтр списка лога по событию (все / только сработавшие подмены) с персистентностью —
 * сохранённый выбор восстанавливается после перезапуска приложения. Поиск по URL сознательно
 * не персистится — это разовый запрос, а не долгоживущая настройка вида списка. */
export function useLogFilters(): {
  eventFilter: EventFilter
  setEventFilter: (filter: EventFilter) => void
} {
  const [eventFilter, setEventFilterState] = useState<EventFilter>(readStoredEventFilter)

  const setEventFilter = (filter: EventFilter): void => {
    localStorage.setItem(EVENT_FILTER_STORAGE_KEY, filter)
    setEventFilterState(filter)
  }

  return { eventFilter, setEventFilter }
}
