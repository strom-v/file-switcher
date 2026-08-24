import { exec } from 'child_process'

/** Промис-обёртка над child_process.exec, используется всеми модулями main-процесса */
export function execAsync(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      resolve(stdout)
    })
  })
}
