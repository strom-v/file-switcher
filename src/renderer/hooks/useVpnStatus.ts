import { useEffect, useState } from 'react'
import type { VpnStatus } from '../../shared/types'

// как часто перепроверяем VPN, пока приложение открыто — VPN может включиться/выключиться в любой
// момент, но детект стоит одного spawn (scutil/powershell), поэтому не чаще раза в 15 с
const VPN_POLL_INTERVAL_MS = 15_000

const NO_VPN: VpnStatus = { active: false, blocksProxy: false }

/** Статус VPN — периодический best-effort опрос main-процесса.
 * `check()` форсирует внеочередную проверку (например, прямо перед запуском прокси) и возвращает результат. */
export function useVpnStatus(): { vpn: VpnStatus; check: () => Promise<VpnStatus> } {
  const [vpn, setVpn] = useState<VpnStatus>(NO_VPN)

  const check = async (): Promise<VpnStatus> => {
    try {
      const status = await window.api.system.vpnStatus()
      setVpn(status)
      return status
    } catch {
      setVpn(NO_VPN)
      return NO_VPN
    }
  }

  useEffect(() => {
    check()
    const timer = setInterval(check, VPN_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  return { vpn, check }
}
