/** Provider-neutral speech synthesis inputs and registration metadata. */
import type { Branded } from '@deepseek-ai/dsh-brand'

// Preparation uses one shared state vocabulary with speech recognition; aliases keep the TTS-facing names exact.
export type {
  SpeechSetupEstimate as SynthesisSetupEstimate,
  SpeechPreparationStepKind as SynthesisPreparationStepKind,
  SpeechPreparationStep as SynthesisPreparationStep,
  SpeechDownloadFailure as SynthesisDownloadFailure,
  SpeechPreparationState as SynthesisPreparationState,
  SpeechPreparationOptions as SynthesisPreparationOptions,
  SpeechPreparation as SynthesisPreparation,
} from '@deepseek-ai/dsh-experimental-speech-to-text/types'

/** Configured identity of one synthesis provider. */
export type SynthesisProviderId = Branded<'SynthesisProviderId'>

/** One selectable voice; credentials and filesystem paths are excluded. */
export interface SynthesisVoice {
  /** Provider-scoped stable identity selected by users, for example `zf_xiaobei`. */
  readonly id: string
  /** Human-readable display name. */
  readonly name: string
  /** Accepted language hints, including `auto` when mixed-language text is supported. */
  readonly languages: readonly string[]
  readonly gender?: 'female' | 'male'
}

/** Public provider facts. */
export interface SynthesisProviderInfo {
  readonly id: SynthesisProviderId
  readonly name: string
  readonly location: 'host-local' | 'cloud'
  readonly voices: readonly SynthesisVoice[]
  readonly setupEstimate?: import('@deepseek-ai/dsh-experimental-speech-to-text/types').SpeechSetupEstimate
  /** Origins offered for an explicit preparation download; omitted or empty when no choice applies. */
  readonly downloadSources?: readonly string[]
}

/** Provider facts and its current resource readiness; independent of plugin activation. */
export interface SynthesisProviderView extends SynthesisProviderInfo {
  readonly preparation: import('@deepseek-ai/dsh-experimental-speech-to-text/types').SpeechPreparationState
}

/** Host-persisted default selection captured when synthesis starts. */
export interface SynthesisSelection {
  readonly providerId: SynthesisProviderId
  readonly voiceId: string
  readonly language: string
}

/** User intent updates only the preference fields explicitly changed. */
export interface SynthesisSelectionPatch {
  readonly providerId?: SynthesisProviderId
  readonly voiceId?: string
  readonly language?: string
}

/** One consistent provider roster and default-selection observation. */
export interface SynthesisSnapshot {
  readonly providers: readonly SynthesisProviderView[]
  readonly selection: SynthesisSelection
}

/** One complete synthesis request in provider terms. */
export interface SynthesisInput {
  /** Plain text to speak; callers bound its length. */
  readonly text: string
  readonly voiceId: string
  readonly language: string
}

/** Synthesized audio as canonical mono PCM16 WAV bytes. */
export interface SynthesisResult {
  readonly audio: Uint8Array
  readonly mimeType: 'audio/wav'
  readonly sampleRate: number
  /** Produced audio duration in seconds. */
  readonly audioSeconds: number
  /** Provider synthesis wall time in seconds. */
  readonly synthesisSeconds: number
}

/** One replaceable synthesizer. It owns preparation, execution, and cancellation. */
export interface SynthesisProvider {
  readonly info: SynthesisProviderInfo
  readonly preparation?: import('@deepseek-ai/dsh-experimental-speech-to-text/types').SpeechPreparation
  /**
   * Synthesize one complete text without writing Session state.
   * @param input - bounded text, voice selection and language.
   * @param signal - caller or registration cancellation; rejection follows resource cleanup.
   * @returns canonical WAV audio and measured durations.
   */
  synthesize(input: SynthesisInput, signal: AbortSignal): Promise<SynthesisResult>
}

/** Caller selection before composition defaults are resolved. */
export interface SynthesisRequest {
  readonly text: string
  readonly providerId?: SynthesisProviderId
  readonly voiceId?: string
  readonly language?: string
}

/** Resolved selection pins the exact registered provider, including its lifetime. */
export interface SynthesisSpec extends SynthesisInput {
  readonly provider: SynthesisProvider
}
