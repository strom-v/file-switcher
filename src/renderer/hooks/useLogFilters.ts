import { useState } from 'react'
import type { ProxyLogEventType } from '../../shared/types'

export const EVENT_FILTER_ALL = 'all' as const
export type EventFilter = ProxyLogEventType | typeof EVENT_FILTER_ALL

// фильтр по наличию тела: 'request' — только записи с непустым requestBody, 'response' — с непустым
// responseBody, null — фильтр выключен, показываются все записи независимо от eventFilter
export type BodyFilter = 'request' | 'response' | null

const EVENT_FILTER_STORAGE_KEY = 'file-switcher:log-event-filter'
const BODY_FILTER_STORAGE_KEY = 'file-switcher:log-body-filter'

function readStoredEventFilter(): EventFilter {
  const stored = localStorage.getItem(EVENT_FILTER_STORAGE_KEY)
  return stored === 'matched' ? 'matched' : EVENT_FILTER_ALL
}

function readStoredBodyFilter(): BodyFilter {
  const stored = localStorage.getItem(BODY_FILTER_STORAGE_KEY)
  return stored === 'request' || stored === 'response' ? stored : null
}

/** Фильтры списка лога (по событию и по наличию тела запроса/ответа) с персистентностью —
 * сохранённый выбор восстанавливается после перезапуска приложения. Поиск по URL сознательно
 * не персистится — это разовый запрос, а не долгоживущая настройка вида списка. */
export function useLogFilters(): {
  eventFilter: EventFilter
  setEventFilter: (filter: EventFilter) => void
  bodyFilter: BodyFilter
  toggleBodyFilter: (value: 'request' | 'response') => void
} {
  const [eventFilter, setEventFilterState] = useState<EventFilter>(readStoredEventFilter)
  const [bodyFilter, setBodyFilterState] = useState<BodyFilter>(readStoredBodyFilter)

  const setEventFilter = (filter: EventFilter): void => {
    localStorage.setItem(EVENT_FILTER_STORAGE_KEY, filter)
    setEventFilterState(filter)
  }

  const toggleBodyFilter = (value: 'request' | 'response'): void => {
    setBodyFilterState((prev) => {
      const next = prev === value ? null : value
      if (next) {
        localStorage.setItem(BODY_FILTER_STORAGE_KEY, next)
      } else {
        localStorage.removeItem(BODY_FILTER_STORAGE_KEY)
      }
      return next
    })
  }

  return { eventFilter, setEventFilter, bodyFilter, toggleBodyFilter }
}
