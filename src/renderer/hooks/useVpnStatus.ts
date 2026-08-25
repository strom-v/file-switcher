import { useEffect, useState } from 'react'

const POLL_INTERVAL_MS = 5000

export interface VpnStatusInfo {
  active: boolean
  /** Имя первого неразрешённого VPN, если удалось определить (см. detectedClientName в main-процессе) */
  name: string | null
}

/**
 * Опрашивает главный процесс на предмет VPN-сервисов, трафик которых прокси не отслеживает.
 * Разрешённые в настройках VPN (allowed: true) не считаются — для них подмена реально работает.
 */
export function useVpnStatus(): VpnStatusInfo {
  const [info, setInfo] = useState<VpnStatusInfo>({ active: false, name: null })

  useEffect(() => {
    let mounted = true

    const check = (): void => {
      window.api.system.vpnServices().then((services) => {
        if (!mounted) return
        const unallowed = services.find((service) => !service.allowed)
        setInfo({ active: !!unallowed, name: unallowed ? (unallowed.name ?? unallowed.detectedClientName ?? null) : null })
      })
    }

    check()
    const interval = setInterval(check, POLL_INTERVAL_MS)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  return info
}
