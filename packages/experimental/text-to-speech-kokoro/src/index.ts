/** Optional local Kokoro provider; activation performs no downloads or model loading. */
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-experimental-text-to-speech'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SynthesisProviderId } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import { Config } from './config.ts'
import { KokoroWorker } from './synthesizer.ts'
import { kokoroVoices } from './voices.ts'

export { Config } from './config.ts'
export const name = 'experimental-text-to-speech-kokoro'
export const inject = ['textToSpeech', 'subprocess']

/**
 * Register the local Kokoro synthesizer and inspect disk caches without downloading or loading models.
 * @param ctx - Host registry and subprocess owner.
 * @param config - validated runtime configuration.
 */
export function apply(ctx: Context, config: Config): void {
  for (const path of [config.dataRoot, config.modelDirectory]) {
    if (path !== undefined && !isAbsolute(path)) throw new Error(`Kokoro paths must be absolute: ${path}`)
  }
  for (const origin of config.modelOrigin === undefined ? config.modelOrigins : [config.modelOrigin]) new URL(origin)
  const worker = new KokoroWorker(ctx, config)
  const estimatedBytes = config.precision === 'int8' ? 600_000_000 : 1_200_000_000
  /* jscpd:ignore-start -- provider registration and inspect-on-activate mirror the SenseVoice provider */
  ctx.effect(() => {
    const unregister = ctx.textToSpeech.register({
      info: {
        id: config.providerId as SynthesisProviderId,
        name: `Kokoro multi-language (${config.precision.toUpperCase()})`,
        location: 'host-local',
        voices: kokoroVoices,
        downloadSources: worker.downloadSources,
        setupEstimate: { recommendedDiskBytes: estimatedBytes, expectedMemoryBytes: estimatedBytes / 2,
          minimumMinutes: 2, maximumMinutes: 15 },
      },
      preparation: worker,
      synthesize: async (input, signal) => await worker.synthesize(input, signal),
    })
    worker.inspect()
    return async () => {
      const removing = unregister()
      await worker.dispose()
      await removing
    }
  })
  /* jscpd:ignore-end */
}
