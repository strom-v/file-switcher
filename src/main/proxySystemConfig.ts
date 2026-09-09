/**
 * Обёртка совместимости над platform-абстракцией системного прокси. Реализация — в
 * src/main/platform/systemProxy.<platform>.ts, выбирается по process.platform в platform/index.ts.
 * Новый код должен импортировать `platform.systemProxy` напрямую.
 */
import { platform } from './platform'

/** Установлено ли разрешение менять системный прокси без запроса пароля (macOS: sudoers-правило) */
export function isSudoersRuleInstalled(): boolean {
  return platform.systemProxy.isPasswordlessSetup()
}

/** Выдаёт такое разрешение через один системный диалог авторизации */
export function installSudoersRule(): Promise<void> {
  return platform.systemProxy.setUpPasswordless()
}

/** Отзывает это разрешение (удаляет sudoers-правило) */
export function removeSudoersRule(): Promise<void> {
  return platform.systemProxy.revokePasswordless()
}

/** Страховка на старте/выходе: откатывает состояние прокси после аварийного завершения приложения */
export function recoverStaleSystemProxy(host: string): Promise<void> {
  return platform.systemProxy.recoverStale(host)
}
