/**
 * urlPattern валидируется в main через JS `new RegExp()`, а исполняется Python `re` в addon.py.
 * Синтаксис двух движков совпадает не полностью: правило, принятое здесь, может молча не работать
 * в прокси. Эта проверка отклоняет конструкции, валидные в JS RegExp, но не в Python re —
 * до сохранения, с понятным сообщением вместо тихого пропуска на каждом запросе.
 *
 * Поддерживаемый поднабор (документирован для пользователя): литералы и классы `[...]`,
 * `.` `*` `+` `?` `{n,m}`, группы `( )` и `(?: )`, именованные группы ТОЛЬКО в форме `(?P<name>...)`,
 * обратные ссылки `(?P=name)` / `\1`, альтернация `|`, якоря `^` `$` в начале/конце, экранирование `\`.
 */

type Incompatibility = { pattern: RegExp; reason: string }

const PYTHON_INCOMPATIBLE: Incompatibility[] = [
  {
    // JS-style именованная группа `(?<name>...)` — в Python re это `(?P<name>...)`
    pattern: /\(\?<(?![=!])/,
    reason: 'именованная группа должна быть в форме (?P<name>...), а не (?<name>...)'
  },
  {
    // JS-style обратная ссылка на имя `\k<name>` — в Python re это `(?P=name)`
    pattern: /\\k<[^>]+>/,
    reason: 'обратная ссылка на имя должна быть в форме (?P=name), а не \\k<name>'
  },
  {
    // \p{...} / \P{...} Unicode property escapes есть в JS (флаг u), в Python re их нет
    pattern: /\\[pP]\{/,
    reason: 'Unicode property escapes (\\p{...}) не поддерживаются'
  }
]

/** null, если urlPattern совместим с Python re; иначе — причина несовместимости */
export function pythonRegexIncompatibility(pattern: string): string | null {
  for (const { pattern: probe, reason } of PYTHON_INCOMPATIBLE) {
    if (probe.test(pattern)) return reason
  }
  // `$` внутри паттерна: в JS без флага m это конец строки и допустимо в середине как «конец или
  // перед завершающим \n»; в Python re `$` в середине почти всегда логическая ошибка — совпадёт
  // только на конце. Не запрещаем (валидно у обоих), но не пытаемся дальше угадывать.
  return null
}
