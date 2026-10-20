/** macOS `say` voice catalog parsing and locale selection. */
import type { SynthesisVoice } from '@deepseek-ai/dsh-experimental-text-to-speech/types'

/** One voice in the `say -v '?'` catalog. */
export interface MacosVoice extends SynthesisVoice {
  /** The catalog locale, for example `zh_CN`. */
  readonly locale: string
}

// The voice name may contain spaces, parentheses and non-Latin text, so the locale token
// anchors the split from the right: name, locale, then an optional `#`-prefixed comment.
const linePattern = /^(?<name>.+?)\s+(?<locale>[a-z]{2,3}(?:_[A-Za-z0-9]+)*)(?:\s+#\s?(?<comment>.*))?$/

/**
 * Map one catalog locale to accepted language hints, following the Kokoro voice convention.
 * @param locale - catalog locale, for example `zh_CN`.
 * @returns language hints, including `auto` when mixed-language text is supported.
 */
function languagesFor(locale: string): readonly string[] {
  const primary = locale.replace(/_.*/, '')
  // Chinese voices also read embedded English; other locales speak their own language only.
  if (primary === 'zh') return ['auto', 'zh', 'en']
  if (primary === 'en') return ['auto', 'en']
  return ['auto', primary]
}

/**
 * Parse `say -v '?'` output into deduplicated voices; the first entry wins a repeated name.
 * @param text - complete catalog output.
 * @returns one voice per distinct CLI name, in catalog order.
 */
export function parseVoiceList(text: string): readonly MacosVoice[] {
  const byName = new Map<string, MacosVoice>()
  for (const line of text.split('\n')) {
    const groups = linePattern.exec(line)?.groups
    const cliName = groups?.['name']
    const locale = groups?.['locale']
    if (cliName === undefined || locale === undefined) continue
    if (byName.has(cliName)) continue
    const display = groups?.['comment']?.trim().replace(/[.。]$/, '')
    byName.set(cliName, {
      id: cliName,
      name: display?.length ? display : cliName,
      locale,
      languages: languagesFor(locale),
    })
  }
  return [...byName.values()]
}

/**
 * Select voices whose locale primary subtag is configured.
 * @param voices - parsed catalog voices.
 * @param locales - configured primary locale subtags.
 * @returns the matching voices, in catalog order.
 */
export function selectVoices(voices: readonly MacosVoice[], locales: readonly string[]): readonly MacosVoice[] {
  const wanted = new Set(locales)
  return voices.filter(voice => wanted.has(voice.locale.replace(/_.*/, '')))
}
