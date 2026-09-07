import { execFile } from 'child_process'

// команды здесь — короткие non-interactive CLI-вызовы платформенных утилит (macOS: networksetup/
// security/openssl; Windows: reg/certutil), не должны висеть дольше пары секунд в норме; таймаут
// страхует от зависания на системном диалоге авторизации или другой аномалии
const DEFAULT_TIMEOUT_MS = 10_000

/** Промис-обёртка над child_process.execFile: аргументы передаются массивом, не собираются
 * в shell-строку — исключает инъекцию через спецсимволы в значениях (например, в имени
 * сетевого сервиса macOS, которое пользователь может переименовать произвольно) */
export function execAsync(command: string, args: string[] = [], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      resolve(stdout)
    })
  })
}
