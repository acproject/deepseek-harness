/**
 * Final acoustic-echo guard: reject a recognized transcript when it repeats
 * text the assistant spoke recently. Browser echo cancellation and the
 * playback-energy gate can both leak on loudspeakers; this compares
 * punctuation-insensitive normalized text as a bounded substring ring.
 */

import { normalizeForEcho } from './segment.ts'

/** One recently spoken sentence. */
interface SpokenEntry {
  readonly text: string
  readonly spokenAt: number
}

/** Retention bounds and clock for one echo guard. */
export interface EchoGuardParams {
  /** Recent spoken text retained, in normalized code points. */
  readonly maxChars: number
  /** Entries older than this are forgotten even when the ring is not full. */
  readonly ttlMs: number
  /** Injected clock for deterministic tests. */
  readonly now: () => number
}

/** Verdict for one recognized transcript. */
export interface EchoGuardResult {
  /** False when the transcript repeats text spoken within the retention window. */
  readonly accepted: boolean
  /** Normalized transcript; callers may reuse it for logging. */
  readonly normalized: string
}

/** Substring echo detector over a bounded recent-speech ring. */
export class EchoGuard {
  private entries: SpokenEntry[] = []
  private chars = 0

  constructor(private readonly params: EchoGuardParams) {}

  /**
   * Record text that reached the speaker.
   * @param text - sentence actually played (or about to play).
   */
  remember(text: string): void {
    const normalized = normalizeForEcho(text)
    if (normalized === '') return
    this.prune()
    this.entries.push({ text: normalized, spokenAt: this.params.now() })
    this.chars += normalized.length
    while (this.chars > this.params.maxChars && this.entries.length > 1) {
      this.chars -= this.entries.shift()?.text.length ?? 0
    }
  }

  /**
   * Decide whether a recognized transcript is a real user utterance.
   * @param transcript - raw ASR text.
   * @returns rejected with the matched spoken text when it is an echo.
   */
  check(transcript: string): EchoGuardResult & { readonly matched?: string } {
    const normalized = normalizeForEcho(transcript)
    if (normalized.length < 4) return { accepted: true, normalized }
    this.prune()
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index]
      if (entry === undefined) continue
      if (entry.text.includes(normalized) || normalized.includes(entry.text)) {
        return { accepted: false, normalized, matched: entry.text }
      }
    }
    return { accepted: true, normalized }
  }

  /** Forget all spoken text; call when the conversation session changes. */
  reset(): void {
    this.entries = []
    this.chars = 0
  }

  private prune(): void {
    const cutoff = this.params.now() - this.params.ttlMs
    while (this.entries.length > 0 && (this.entries[0]?.spokenAt ?? Infinity) < cutoff) {
      this.chars -= this.entries.shift()?.text.length ?? 0
    }
  }
}
