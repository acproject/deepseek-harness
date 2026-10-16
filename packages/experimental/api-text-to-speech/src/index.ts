/** Authenticated, cancellation-aware Client access to the synthesis capability. */
import { Buffer } from 'node:buffer'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-experimental-text-to-speech'
import type { SynthesisPreparationOptions, SynthesisProviderId, SynthesisSelectionPatch } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import type { SynthesizedAudioWire, SynthesisRequestWire, TtsCatalog } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Experimental synthesis Remote controller. */
    ttsController: TtsController
  }
}

/** Limits applied before resolution or calling a provider. */
export interface Config {
  /** Maximum request text length in Unicode code points. */
  maxTextChars: number
  /** Maximum returned WAV bytes. */
  maxAudioBytes: number
}

/** Synthesis calls never activate or submit to an Agent. */
export default class TtsController extends TypertRemoteService {
  static inject = ['textToSpeech', 'typert']
  static Config: z<Config> = z.object({
    maxTextChars: z.natural().min(1).default(500),
    maxAudioBytes: z.natural().min(44).default(16 * 1024 * 1024),
  })

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'ttsController', { namespace: 'tts' })
  }

  /* jscpd:ignore-start -- catalog observation mirrors the speech Remote controller */
  /**
   * Read provider choices without preparing a synthesizer.
   * @returns available providers, resolved default, and intake limits.
   */
  @Remote
  catalog(): TtsCatalog {
    return { ...this.ctx.textToSpeech.snapshot(), ...this.config }
  }

  /**
   * Follow provider readiness independently of Session and preparation lifetimes.
   * @param signal - Client observation lifetime.
   * @returns initial and subsequent complete readiness snapshots.
   */
  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<TtsCatalog> {
    for await (const snapshot of this.ctx.textToSpeech.follow(signal)) yield { ...snapshot, ...this.config }
  }

  /**
   * Persist the user's synthesis preferences.
   * @param patch - changed preference fields.
   * @returns after preferences are saved.
   */
  @Remote
  configure(patch: SynthesisSelectionPatch): Promise<void> { return this.ctx.textToSpeech.configure(patch) }

  /**
   * Start or join one Host-owned preparation task.
   * @param providerId - selected synthesizer.
   * @param options - task-local source selection validated by the provider.
   */
  @Remote
  prepare(providerId: SynthesisProviderId, options?: SynthesisPreparationOptions): void {
    this.ctx.textToSpeech.prepare(providerId, options)
  }

  /**
   * Explicitly cancel resource preparation.
   * @param providerId - selected synthesizer.
   * @returns after the preparation task settles.
   */
  @Remote
  cancelPreparation(providerId: SynthesisProviderId): Promise<void> {
    return this.ctx.textToSpeech.cancelPreparation(providerId)
  }
  /* jscpd:ignore-end */

  /**
   * Validate and synthesize one text through the explicit provider selection.
   * @param request - text, provider id, voice id and language hint.
   * @param signal - Client cancellation or Remote contribution disposal.
   * @returns canonical WAV encoded as base64, without adding a Session event.
   */
  @Remote
  async synthesize(request: SynthesisRequestWire, signal: AbortSignal): Promise<SynthesizedAudioWire> {
    signal.throwIfAborted()
    const text = request.text
    if (text.trim() === '' || Array.from(text).length > this.config.maxTextChars) {
      throw new RemoteError('tts/invalid-text', 'Text is empty or exceeds the configured length', { reason: 'empty-or-length' })
    }
    try {
      const spec = this.ctx.textToSpeech.resolve({ text,
        ...request.providerId === undefined ? {} : { providerId: request.providerId },
        ...request.voiceId === undefined ? {} : { voiceId: request.voiceId },
        ...request.language === undefined ? {} : { language: request.language },
      })
      const result = await this.ctx.textToSpeech.synthesize(spec, signal)
      if (result.audio.length > this.config.maxAudioBytes) throw new Error('Synthesized audio exceeds the configured byte limit')
      return {
        audioBase64: Buffer.from(result.audio).toString('base64'),
        mimeType: 'audio/wav',
        sampleRate: result.sampleRate,
        audioSeconds: result.audioSeconds,
        synthesisSeconds: result.synthesisSeconds,
      }
    } catch (error) {
      signal.throwIfAborted()
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('tts/synthesis-failed', reason, { reason })
    }
  }
}
