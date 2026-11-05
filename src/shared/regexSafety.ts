/**
 * urlPattern исполняется JS RegExp прямо в main-процессе прокси. Катастрофический backtracking
 * на одном URL заморозил бы и прокси, и весь UI, поэтому правила ограничены безопасным поднабором:
 * литералы, классы `[...]`, группы `( )`, `(?: )`, `(?<name> )`, якоря и альтернация. Запрещены
 * lookaround, обратные ссылки, несколько повторяемых wildcard и повторяемая группа с alternation
 * либо другим repeat — именно эти конструкции дают экспоненциальный перебор.
 */

export const MAX_REGEX_PATTERN_LENGTH = 2_048

interface GroupFrame {
  hasRepeat: boolean
  hasAlternation: boolean
}

type Atom = { kind: 'simple'; isWildcard: boolean } | { kind: 'group'; frame: GroupFrame }

/** null, если regex входит в безопасный поднабор; иначе причина отказа */
export function unsafeRegexReason(pattern: string): string | null {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return `шаблон длиннее ${MAX_REGEX_PATTERN_LENGTH} символов`
  }

  const frames: GroupFrame[] = [{ hasRepeat: false, hasAlternation: false }]
  let lastAtom: Atom | null = null
  let lastWasQuantifier = false
  let repeatedWildcards = 0
  let index = 0

  while (index < pattern.length) {
    const char = pattern[index]

    if (char === '\\') {
      const escaped = pattern[index + 1]
      if (escaped === undefined) break
      if (/[1-9]/.test(escaped) || escaped === 'k') {
        return 'обратные ссылки не поддерживаются'
      }
      lastAtom = { kind: 'simple', isWildcard: false }
      lastWasQuantifier = false
      index += 2
      continue
    }

    if (char === '[') {
      index++
      while (index < pattern.length) {
        if (pattern[index] === '\\') {
          index += 2
          continue
        }
        if (pattern[index] === ']') {
          index++
          break
        }
        index++
      }
      lastAtom = { kind: 'simple', isWildcard: false }
      lastWasQuantifier = false
      continue
    }

    if (char === '(') {
      if (pattern.startsWith('(?:', index)) {
        index += 3
      } else if (pattern.startsWith('(?<', index) && !/^\(\?<[=!]/.test(pattern.slice(index))) {
        const nameEnd = pattern.indexOf('>', index + 3)
        if (nameEnd === -1) break
        index = nameEnd + 1
      } else if (pattern.startsWith('(?', index)) {
        return 'lookaround и специальные группы не поддерживаются'
      } else {
        index++
      }
      frames.push({ hasRepeat: false, hasAlternation: false })
      lastAtom = null
      lastWasQuantifier = false
      continue
    }

    if (char === ')') {
      if (frames.length === 1) break
      const frame = frames.pop() as GroupFrame
      const parent = frames[frames.length - 1]
      parent.hasRepeat ||= frame.hasRepeat
      parent.hasAlternation ||= frame.hasAlternation
      lastAtom = { kind: 'group', frame }
      lastWasQuantifier = false
      index++
      continue
    }

    if (char === '|') {
      frames[frames.length - 1].hasAlternation = true
      lastAtom = null
      lastWasQuantifier = false
      index++
      continue
    }

    let quantifierEnd: number | null = null
    if (char === '*' || char === '+' || char === '?') {
      // ленивый квантификатор (`*?`, `+?`) — продолжение предыдущего, а не новый repeat
      if (char === '?' && lastWasQuantifier) {
        lastWasQuantifier = false
        index++
        continue
      }
      quantifierEnd = index + 1
    } else if (char === '{') {
      const quantifier = pattern.slice(index).match(/^\{\d+(?:,\d*)?\}/)
      if (quantifier) quantifierEnd = index + quantifier[0].length
    }

    if (quantifierEnd !== null && lastAtom !== null) {
      if (lastAtom.kind === 'group' && (lastAtom.frame.hasRepeat || lastAtom.frame.hasAlternation)) {
        return 'повторяемая группа содержит repeat или alternation'
      }
      frames[frames.length - 1].hasRepeat = true
      if (lastAtom.kind === 'simple' && lastAtom.isWildcard) {
        repeatedWildcards++
        if (repeatedWildcards > 1) return 'несколько повторяемых wildcard не поддерживаются'
      }
      lastWasQuantifier = true
      index = quantifierEnd
      continue
    }

    lastAtom = char === '^' || char === '$' ? null : { kind: 'simple', isWildcard: char === '.' }
    lastWasQuantifier = false
    index++
  }

  return null
}
