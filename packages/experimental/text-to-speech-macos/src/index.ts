/** Optional macOS system speech provider; activation reads the `say` voice catalog. */
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-experimental-text-to-speech'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SynthesisProviderId } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { Config } from './config.ts'
import { assertDarwinHost } from './platform.ts'
import { SaySynthesizer } from './synthesizer.ts'
import { parseVoiceList, selectVoices } from './voices.ts'

export { Config } from './config.ts'
export const name = 'experimental-text-to-speech-macos'
export const inject = ['textToSpeech', 'subprocess']

/**
 * Register the macOS system speech synthesizer after reading its voice catalog.
 * @param ctx - Host registry and subprocess owner.
 * @param config - validated runtime configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  assertDarwinHost()
  using listing = deadline(undefined, config.voiceListTimeoutMs, 'TTS_MACOS_VOICE_LIST_TIMEOUT')
  const handle = ctx.subprocess.spawn({
    argv: [config.command, '-v', '?'],
    cwd: tmpdir(),
    graceMs: config.graceMs,
    signal: listing.signal,
    stdio: { stdin: 'ignore', stdout: { maxBytes: config.maxLogBytes }, stderr: { maxBytes: config.maxLogBytes } },
  })
  const outcome = await handle.done
  listing.signal.throwIfAborted()
  if (outcome.exitCode !== 0) {
    const detail = handle.collected.stderr?.readFrom(0).text.trim()
    throw new Error(`macOS speech voice listing failed (exit code ${outcome.exitCode ?? 'null'}, signal ${outcome.signal})${detail ? `: ${detail}` : ''}`)
  }
  const voices = selectVoices(parseVoiceList(handle.collected.stdout?.readFrom(0).text ?? ''), config.locales)
  if (voices.length === 0) throw new Error(`macOS speech voice catalog has no voices for locales: ${config.locales.join(', ')}`)
  const synthesizer = new SaySynthesizer(ctx, config, voices)
  ctx.effect(() => {
    const unregister = ctx.textToSpeech.register({
      info: {
        id: config.providerId as SynthesisProviderId,
        name: 'macOS System Speech (say)',
        location: 'host-local',
        voices,
      },
      synthesize: async (input, signal) => await synthesizer.synthesize(input, signal),
    })
    return async () => { await unregister() }
  })
}
