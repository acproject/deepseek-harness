/** Kokoro text limits and input failures that leave the loaded synthesizer reusable. */

/** A request rejected before native synthesis; the loaded worker remains reusable. */
export class SynthesisInputError extends Error {}

/**
 * Validate text before touching the native synthesizer.
 * @param text - untrusted JSON request text.
 * @param maxTextChars - configured code-point length limit.
 */
export function validateText(text: string, maxTextChars: number): void {
  if (text.trim().length === 0) throw new SynthesisInputError('Synthesis text must not be empty')
  if (Array.from(text).length > maxTextChars) throw new SynthesisInputError('Synthesis text exceeds the code-point limit')
}
