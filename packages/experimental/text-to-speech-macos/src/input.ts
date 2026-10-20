/** macOS system speech text limits and input failures that leave the provider reusable. */

/** A request rejected before the `say` process starts; later requests are unaffected. */
export class SynthesisInputError extends Error {}

/**
 * Validate text before spawning `say`.
 * @param text - untrusted JSON request text.
 * @param maxTextChars - configured code-point length limit.
 */
export function validateText(text: string, maxTextChars: number): void {
  if (text.trim().length === 0) throw new SynthesisInputError('Synthesis text must not be empty')
  if (Array.from(text).length > maxTextChars) throw new SynthesisInputError('Synthesis text exceeds the code-point limit')
}
