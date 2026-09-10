import { useCallback, useEffect, useRef, useState } from 'react'
import type { VpnStatus } from '../../shared/types'

// детект VPN стоит одного spawn (scutil/powershell) — на macOS это route+scutil+ifconfig+ps.
// Начинаем с 15 с, а пока статус не меняется — увеличиваем интервал до минуты, чтобы простаивающая
// утилита не будила CPU каждые 15 с весь рабочий день
const VPN_POLL_MIN_MS = 15_000
const VPN_POLL_MAX_MS = 60_000

const NO_VPN: VpnStatus = { active: false, blocksProxy: false }

function sameStatus(a: VpnStatus, b: VpnStatus): boolean {
  return a.active === b.active && a.blocksProxy === b.blocksProxy
}

/** Статус VPN — периодический best-effort опрос main-процесса.
 * `check()` форсирует внеочередную проверку (например, прямо перед запуском прокси) и возвращает результат. */
export function useVpnStatus(): { vpn: VpnStatus; check: () => Promise<VpnStatus> } {
  const [vpn, setVpn] = useState<VpnStatus>(NO_VPN)
  const vpnRef = useRef(vpn)
  vpnRef.current = vpn

  const check = useCallback(async (): Promise<VpnStatus> => {
    try {
      const status = await window.api.system.vpnStatus()
      setVpn(status)
      return status
    } catch {
      setVpn(NO_VPN)
      return NO_VPN
    }
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let interval = VPN_POLL_MIN_MS
    let stopped = false

    const tick = async (): Promise<void> => {
      // окно свёрнуто/не на экране — не тратим spawn, вернёмся к опросу по 'visibilitychange'
      if (document.hidden) return
      const before = vpnRef.current
      const after = await check()
      // статус не изменился — растягиваем интервал; изменился — возвращаемся к частому опросу
      interval = sameStatus(before, after) ? Math.min(interval * 2, VPN_POLL_MAX_MS) : VPN_POLL_MIN_MS
      schedule()
    }

    const schedule = (): void => {
      if (stopped) return
      clearTimeout(timer)
      timer = setTimeout(tick, interval)
    }

    const onVisibility = (): void => {
      if (!document.hidden) {
        interval = VPN_POLL_MIN_MS
        check()
        schedule()
      }
    }

    check()
    schedule()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [check])

  return { vpn, check }
}
