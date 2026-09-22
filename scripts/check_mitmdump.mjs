// Предпроверка перед electron-builder: standalone-бинарник mitmdump для текущей платформы
// должен лежать в resources/bin (закоммичен в репозиторий). Без него electron-builder соберёт
// установщик "успешно" (extraResources молча пропускается), а приложение упадёт уже у
// пользователя с "mitmdump не найден" — лучше упасть здесь с понятным сообщением.
import { existsSync } from 'node:fs'

const PER_PLATFORM = {
  darwin: 'resources/bin/mac/mitmdump',
  win32: 'resources/bin/win/mitmdump.exe',
  linux: 'resources/bin/linux/mitmdump'
}

const expected = PER_PLATFORM[process.platform]
if (!expected) {
  console.error(`неизвестная платформа ${process.platform} — нет пути к бинарнику mitmdump`)
  process.exit(1)
}
if (!existsSync(expected)) {
  const buildScript = process.platform === 'win32' ? 'powershell -File scripts/build_mitmdump.ps1' : 'scripts/build_mitmdump.sh'
  console.error(`mitmdump не найден: ${expected}`)
  console.error(`соберите один раз: ${buildScript}  (и закоммитьте результат в репозиторий)`)
  process.exit(1)
}
