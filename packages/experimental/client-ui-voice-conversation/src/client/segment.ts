/**
 * Prefix-stable speech text segmentation.
 *
 * The assistant feed repeatedly splits a growing transcription stream. Every
 * emitted segment must stay identical when later characters arrive, so the
 * feed can dedupe by segment index without re-speaking. Boundary and cap
 * decisions therefore look only at the prefix scanned so far.
 */

/** Sentence-final terminators spoken as a full stop in Chinese or English. */
const TERMINATORS = new Set(['。', '！', '？', '!', '?', '；', ';', '\n', '\r'])
/** Clause separators used only to keep an over-long segment speakable. */
const CLAUSE_SEPARATORS = new Set(['，', ',', '、', '：', ':', '—', '…'])
/** Closing marks that stay attached to a preceding terminator. */
const CLOSING_MARKS = new Set(['”', '’', '」', '』', '）', ')', ']', '】', '》', '"', "'"])

/** Result of splitting one prefix into ready speech and its open remainder. */
export interface SpeechSplit {
  /** Complete segments in speaking order, stable once emitted. */
  readonly complete: readonly string[]
  /** Trailing text without a terminator; held for the next split. */
  readonly remainder: string
}

/**
 * Remove fenced code blocks; model output inside them is not meant to be read.
 * An unterminated fence at the tail hides the partial block as well, since a
 * later delta may only be completing code. Inline code keeps its text without
 * the backticks.
 * @param text - raw model text.
 * @returns text without fenced spans and without inline-code backticks.
 */
export function stripCodeFences(text: string): string {
  return text
    .replace(/```[^\n\r]*[\s\S]*?(?:```|$)/g, '')
    .replace(/`([^`\n\r]+)`/g, '$1')
}

/**
 * Whether text contains anything worth speaking.
 * @param text - candidate segment.
 * @returns false for punctuation- or whitespace-only text.
 */
export function hasSpeakable(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
}

/**
 * Normalize a transcript or spoken sentence for echo comparison: lowercase
 * letters and drop whitespace, separators and punctuation, keeping letters,
 * ideographs, digits and combining marks.
 * @param text - spoken or recognized text.
 * @returns code points joined for substring matching.
 */
export function normalizeForEcho(text: string): string {
  return Array.from(text.toLowerCase())
    .filter(codePoint => /[\p{L}\p{N}]/u.test(codePoint))
    .join('')
}

/**
 * Split a growing text prefix into speakable segments.
 * @param text - complete text seen so far (streaming deltas already joined).
 * @param maxChars - maximum code points for one synthesis request.
 * @returns complete prefix-stable segments plus the unfinished tail.
 */
export function splitSpeech(text: string, maxChars: number): SpeechSplit {
  const cleaned = stripCodeFences(text)
  const codePoints = Array.from(cleaned)
  const complete: string[] = []
  let cursor = 0
  while (cursor < codePoints.length) {
    const boundary = nextBoundary(codePoints, cursor, maxChars)
    if (boundary === undefined) break
    const segment = codePoints.slice(cursor, boundary).join('').trim()
    if (hasSpeakable(segment)) complete.push(segment)
    cursor = boundary
  }
  return { complete, remainder: codePoints.slice(cursor).join('') }
}

/**
 * Find the end of the next segment after `start`.
 * A terminator closes a sentence, swallowing adjacent closing marks; a run of
 * dots acts as one terminator. Without a terminator inside the cap, the last
 * clause separator or the cap itself cuts. Every decision reads only the
 * prefix up to the cut, keeping emitted segments stable.
 */
function nextBoundary(codePoints: readonly string[], start: number, maxChars: number): number | undefined {
  const limit = Math.min(codePoints.length, start + maxChars)
  for (let index = start; index < limit; index += 1) {
    const codePoint = codePoints[index]
    if (codePoint === undefined) break
    if (codePoint === '.') {
      let end = index + 1
      while (end < limit && codePoints[end] === '.') end += 1
      while (end < codePoints.length && codePoints[end] !== undefined && CLOSING_MARKS.has(codePoints[end] as string)) end += 1
      return end
    }
    if (TERMINATORS.has(codePoint)) {
      let end = index + 1
      while (end < codePoints.length && codePoints[end] !== undefined && CLOSING_MARKS.has(codePoints[end] as string)) end += 1
      return end
    }
  }
  if (codePoints.length - start <= maxChars) return undefined
  for (let index = limit - 1; index > start; index -= 1) {
    const codePoint = codePoints[index]
    if (codePoint !== undefined && CLAUSE_SEPARATORS.has(codePoint)) return index + 1
  }
  return limit
}
