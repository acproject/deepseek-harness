/** JSON-safe inputs and results of the experimental synthesis Remote namespace. */
import type { SynthesisProviderId, SynthesisSnapshot } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Empty or over-long text prevented synthesis. */
    'tts/invalid-text': { readonly reason: string }
    /** The selected provider rejected synthesis. */
    'tts/synthesis-failed': { readonly reason: string }
  }
}

/** Complete text submitted for synthesis, separate from Session admission. */
export interface SynthesisRequestWire {
  readonly text: string
  readonly providerId?: SynthesisProviderId
  readonly voiceId?: string
  readonly language?: string
}

/** Synthesis audio returned to the browser. */
export interface SynthesizedAudioWire {
  readonly audioBase64: string
  readonly mimeType: 'audio/wav'
  readonly sampleRate: number
  readonly audioSeconds: number
  readonly synthesisSeconds: number
}

/** Current provider choices and synthesis intake limits. */
export interface TtsCatalog extends SynthesisSnapshot {
  readonly maxTextChars: number
  readonly maxAudioBytes: number
}
