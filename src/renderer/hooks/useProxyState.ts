import { useEffect, useRef, useState } from 'react'
import type { ProxyState, ProxyLogEvent } from '../../shared/types'

// буфер живёт на window, а не в useState: в dev-режиме Vite HMR при live-редактировании
// этого хука/LogPanel может пересоздать компонент с чистым состоянием — window переживает
// такую пересборку модуля, так что накопленные логи не пропадают на лету во время правок
function getLogBuffer(): ProxyLogEvent[] {
  if (!window.__fileSwitcherLogBuffer) window.__fileSwitcherLogBuffer = []
  return window.__fileSwitcherLogBuffer
}

// лимит хранения применяется отдельно к каждой категории (matched/passed), не к общему потоку —
// иначе большой объём обычного трафика вытесняет из буфера все записи о сработавших подменах
function trimByCategory(entries: ProxyLogEvent[], maxPerCategory: number): ProxyLogEvent[] {
  const matched = entries.filter((e) => e.event === 'matched')
  const passed = entries.filter((e) => e.event === 'passed')
  const trimmedMatched = matched.length > maxPerCategory ? matched.slice(matched.length - maxPerCategory) : matched
  const trimmedPassed = passed.length > maxPerCategory ? passed.slice(passed.length - maxPerCategory) : passed
  return [...trimmedMatched, ...trimmedPassed].sort((a, b) => a.ts - b.ts)
}

/** Подписывается на статус и лог прокси через IPC; в памяти хранится не больше storageLimit записей на каждую категорию (сработавшие подмены / остальной трафик) — независимо от того, что выбрано для отображения в LogPanel */
export function useProxyState(
  storageLimit: number,
  onStderr?: (text: string) => void
): {
  status: ProxyState
  logs: ProxyLogEvent[]
  clearLogs: () => void
} {
  const [status, setStatus] = useState<ProxyState>({ status: 'stopped', port: 8080 })
  const [logs, setLogs] = useState<ProxyLogEvent[]>(getLogBuffer)
  const mounted = useRef(true)
  const onStderrRef = useRef(onStderr)
  onStderrRef.current = onStderr
  const storageLimitRef = useRef(storageLimit)
  storageLimitRef.current = storageLimit

  // пишет и в window-буфер (переживает HMR), и в React state (вызывает ре-рендер)
  const updateLogs = (updater: (prev: ProxyLogEvent[]) => ProxyLogEvent[]): void => {
    const next = updater(getLogBuffer())
    window.__fileSwitcherLogBuffer = next
    setLogs(next)
  }

  // при уменьшении лимита обрезаем уже накопленные записи сразу, не дожидаясь следующего события лога
  useEffect(() => {
    updateLogs((prev) => trimByCategory(prev, storageLimit))
  }, [storageLimit])

  useEffect(() => {
    mounted.current = true

    window.api.proxy.status().then((state) => {
      if (mounted.current) setStatus(state)
    })

    const offStatus = window.api.proxy.onStatus((state) => {
      setStatus(state)
    })

    // события приходят пачками — один updateLogs (и, соответственно, один React-рендер)
    // на пачку, а не на каждое отдельное событие трафика
    const offLog = window.api.proxy.onLogBatch((batch) => {
      updateLogs((prev) => trimByCategory([...prev, ...batch], storageLimitRef.current))
    })

    const offStderr = window.api.proxy.onStderr((text) => {
      onStderrRef.current?.(text)
    })

    return () => {
      mounted.current = false
      offStatus()
      offLog()
      offStderr()
    }
  }, [])

  return { status, logs, clearLogs: () => updateLogs(() => []) }
}
