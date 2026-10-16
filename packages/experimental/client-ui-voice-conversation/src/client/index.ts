/** Browser entry for the speech + TTS Remotes and the always-on voice loop. */
import type { Context } from '@deepseek-ai/cordis'
import speechRemote from '@deepseek-ai/dsh-experimental-api-speech-to-text/remote'
import ttsRemote from '@deepseek-ai/dsh-experimental-api-text-to-speech/remote'
import { mountVoiceConversation } from './mount.ts'

export { inject } from './mount.ts'

/**
 * Activate the experimental always-on voice conversation contribution.
 * @param ctx - Client runtime.
 * @returns complete UI and Remote disposer.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountVoiceConversation(ctx, speechRemote, ttsRemote)
}
