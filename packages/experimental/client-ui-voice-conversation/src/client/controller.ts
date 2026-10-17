/**
 * Always-on voice conversation controller. It owns one Session-scope loop:
 * microphone segments become local transcriptions and ordinary user prompts;
 * the assistant event window becomes ordered local synthesis jobs and serial
 * playback. Barge-in cancels in-flight speech before the new prompt is sent.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { Transcript } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { TranscriptionRequest } from '@deepseek-ai/dsh-experimental-api-speech-to-text/types'
import type {
  SynthesizedAudioWire,
  SynthesisRequestWire,
} from '@deepseek-ai/dsh-experimental-api-text-to-speech/types'
import type { SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import { audioBase64, encodeWave } from '@deepseek-ai/dsh-experimental-client-ui-voice-input/audio'
import { AssistantSpeechFeed, type AssistantSpeechHandler } from './assistant-feed.ts'
import { AlwaysOnCapture, CaptureError, type CaptureHandlers } from './capture.ts'
import { EchoGuard } from './echo-guard.ts'
import { SpeechPlayback, detectHeadphones, type SpeechPlaybackHandlers } from './playback.ts'
import type { SpeechReadiness, TtsReadiness } from './readiness.ts'
import { hasSpeakable } from './segment.ts'
import type { VadState } from './vad.ts'

/** Recent-speech ring size and lifetime for the text echo guard. */
const ECHO_MAX_CHARS = 800
const ECHO_TTL_MS = 45_000

/** Voice loop phases rendered by the activity control. */
export type VoicePhase =
  | 'off'
  | 'starting'
  | 'calibrating'
  | 'listening'
  | 'hearing'
  | 'transcribing'
  | 'thinking'
  | 'speaking'

/** Localized-at-boundary failure kinds. */
export type VoiceErrorKind =
  | 'not-ready'
  | 'capture-unavailable'
  | 'capture-permission'
  | 'capture-device-missing'
  | 'capture-interrupted'
  | 'transcribe-failed'
  | 'synthesize-failed'
  | 'submit-failed'

/** Failure with a stable kind mapped through the locale dictionary by the UI. */
export class VoiceError extends Error {
  constructor(readonly kind: VoiceErrorKind, message?: string) {
    super(message ?? kind)
    this.name = 'VoiceError'
  }
}

/** Renderable voice-loop state consumed by the activity slot. */
export interface VoiceUiState {
  readonly phase: VoicePhase
  /** Muting keeps the loop running but skips synthesizing and playing replies. */
  readonly muted: boolean
  readonly speakerWarning: boolean
  readonly error: { readonly kind: VoiceErrorKind; readonly message: string | null } | null
}

/** Session and Remote seams required by one voice loop; the mount binds them in Session scope. */
export interface VoiceConversationDeps {
  readonly speech: SnapshotStore<SpeechReadiness>
  readonly tts: SnapshotStore<TtsReadiness>
  /** Enqueue one ordinary user turn in the scoped session. */
  send(text: string): Promise<void>
  /** Cancel the scoped session's running turn. */
  cancel(): Promise<void>
  subscribeSession(listener: () => void): () => void
  sessionRunning(): boolean
  subscribeEvents(listener: () => void): () => void
  eventWindow(): SessionEventWindow
  transcribe(request: TranscriptionRequest, signal: AbortSignal): Promise<RemoteResult<Transcript>>
  synthesize(request: SynthesisRequestWire, signal: AbortSignal): Promise<RemoteResult<SynthesizedAudioWire>>
}

/** Capture seam used by the loop; {@link AlwaysOnCapture} satisfies it. */
export interface CaptureLike {
  start(options: { deviceId: string; maxDurationSeconds: number }): Promise<void>
  stop(): Promise<void>
  amplitude(): number
  setPlaybackActive(active: boolean): void
}

/** Playback seam used by the loop; {@link SpeechPlayback} satisfies it. */
export interface PlaybackLike {
  readonly speaking: boolean
  enqueue(key: string, text: string, bytes: Uint8Array, signal: AbortSignal): void
  cancelAll(): void
  dispose(): Promise<void>
}

/** Optional device seams; tests inject fakes without browser globals. */
export interface ControllerPieces {
  makeCapture?(handlers: CaptureHandlers): CaptureLike
  makePlayback?(handlers: SpeechPlaybackHandlers): PlaybackLike
}

function preparationUsable(preparation: { readonly phase: string }): boolean {
  return preparation.phase === 'ready' || preparation.phase === 'standby'
}

/** Decode base64 audio returned by the TTS Remote. */
export function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** One Session-scope always-on voice loop. */
export class VoiceController {
  private readonly deps: VoiceConversationDeps
  /** Subscribable render state; the UI reads it through useSyncExternalStore. */
  readonly state: SnapshotStore<VoiceUiState>
  private readonly capture: CaptureLike
  private readonly playback: PlaybackLike
  private readonly echoGuard: EchoGuard

  private runSignal: AbortController | undefined
  private feed: AssistantSpeechFeed | undefined
  private unsubscribers: Array<() => void> = []
  private readonly synthJobs = new Map<string, AbortController>()
  private pipelineTail: Promise<void> = Promise.resolve()
  /**
   * Resolves when the latest sentence's synthesis request settles; serializes Remote calls so a long
   * reply cannot exceed the host provider's pending-request cap.
   */
  private synthGate: Promise<void> = Promise.resolve()
  private pendingSynth = 0
  private segmentChain: Promise<void> = Promise.resolve()
  private gateState: VadState = 'calibrating'
  private started = false
  private busy = false
  private audible = false

  constructor(deps: VoiceConversationDeps, pieces: ControllerPieces = {}) {
    this.deps = deps
    this.state = createSnapshotStore<VoiceUiState>({ phase: 'off', muted: false, speakerWarning: false, error: null })
    this.echoGuard = new EchoGuard({ maxChars: ECHO_MAX_CHARS, ttlMs: ECHO_TTL_MS, now: () => Date.now() })
    const captureHandlers: CaptureHandlers = {
      onLevel: () => undefined,
      onSegmentStart: () => { this.recompute() },
      onGateState: (state) => { this.gateState = state; this.recompute() },
      onSegment: (samples) => { this.segmentChain = this.segmentChain.then(() => this.handleSegment(samples)).catch(() => undefined) },
      onError: (error) => { this.failCapture(error) },
    }
    const playbackHandlers: SpeechPlaybackHandlers = {
      onStart: (text) => {
        this.audible = true
        this.echoGuard.remember(text)
        this.recompute()
      },
      onDrain: () => { this.recompute() },
    }
    this.capture = pieces.makeCapture?.(captureHandlers) ?? new AlwaysOnCapture(captureHandlers)
    this.playback = pieces.makePlayback?.(playbackHandlers) ?? new SpeechPlayback(playbackHandlers)
  }

  /**
   * Latest microphone RMS for rAF-driven UI.
   * @returns current capture amplitude in 0..1.
   */
  amplitude(): number {
    return this.capture.amplitude()
  }

  /** Toggle reply playback without interrupting capture, transcription or the session loop. */
  setMuted(muted: boolean): void {
    const snapshot = this.state.getSnapshot()
    if (snapshot.muted !== muted) this.setState({ ...snapshot, muted })
  }

  /** Whether the loop owns the microphone. */
  get isActive(): boolean {
    return this.started
  }

  /**
   * Start the always-on loop with the selected microphone.
   * @param deviceId - preferred device id, or empty for system default.
   */
  async start(deviceId: string): Promise<void> {
    if (this.started) return
    const speechCatalog = this.deps.speech.getSnapshot().catalog
    const ttsCatalog = this.deps.tts.getSnapshot().catalog
    if (!this.deps.speech.getSnapshot().connected || !this.deps.tts.getSnapshot().connected
      || speechCatalog === null || ttsCatalog === null) {
      throw new VoiceError('not-ready')
    }
    const speechProvider = speechCatalog.providers.find(provider => provider.id === speechCatalog.selection.providerId)
    const ttsProvider = ttsCatalog.providers.find(provider => provider.id === ttsCatalog.selection.providerId)
    if (speechProvider === undefined || ttsProvider === undefined
      || !preparationUsable(speechProvider.preparation) || !preparationUsable(ttsProvider.preparation)) {
      throw new VoiceError('not-ready')
    }
    this.clearError()
    this.setState({ ...this.state.getSnapshot(), phase: 'starting' })
    this.runSignal = new AbortController()
    this.feed = new AssistantSpeechFeed(this.deps.eventWindow(), this.feedHandler, ttsCatalog.maxTextChars)
    this.unsubscribers = [
      this.deps.subscribeEvents(() => this.feed?.notify(this.deps.eventWindow())),
      this.deps.subscribeSession(() => { this.recompute() }),
    ]
    this.echoGuard.reset()
    try {
      await this.capture.start({ deviceId, maxDurationSeconds: speechCatalog.maxDurationSeconds })
    } catch (error) {
      this.teardown()
      if (error instanceof CaptureError) throw new VoiceError(`capture-${error.kind}` as VoiceErrorKind)
      throw error
    }
    if (this.runSignal.signal.aborted) {
      this.teardown()
      throw new VoiceError('capture-interrupted')
    }
    this.started = true
    this.audible = false
    this.recompute()
    void detectHeadphones().then((isHeadphones) => {
      if (isHeadphones === false && this.started) {
        this.setState({ ...this.state.getSnapshot(), speakerWarning: true })
      }
    }).catch(() => undefined)
  }

  /** Stop listening, cancel speech and release the microphone. */
  async stop(): Promise<void> {
    if (!this.started && this.runSignal === undefined) return
    this.runSignal?.abort(new VoiceError('capture-interrupted'))
    this.cancelAssistantSpeech()
    await this.capture.stop()
    this.teardown()
    this.setState({ ...this.state.getSnapshot(), phase: 'off', speakerWarning: false, error: this.state.getSnapshot().error })
  }

  /** Release every resource when the Session UI unmounts. */
  async dispose(): Promise<void> {
    await this.stop()
    await this.playback.dispose()
  }

  /**
   * Whether an awaited step lost the race against stop/dispose.
   * @param signal - run-abort signal captured before the first await.
   * @returns true once the loop must ignore the step's result.
   */
  private loopEnded(signal: AbortSignal): boolean {
    return !this.started || signal.aborted
  }

  private teardown(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    this.unsubscribers = []
    this.runSignal = undefined
    this.feed = undefined
    this.started = false
    this.busy = false
    this.pendingSynth = 0
    this.synthJobs.clear()
    this.gateState = 'calibrating'
  }

  private async handleSegment(samples: Float32Array): Promise<void> {
    const runSignal = this.runSignal?.signal
    if (!this.started || runSignal === undefined || runSignal.aborted) return
    const speechCatalog = this.deps.speech.getSnapshot().catalog
    if (speechCatalog === null) return
    this.busy = true
    this.recompute()
    try {
      const wave = encodeWave(samples)
      if (wave.byteLength > speechCatalog.maxAudioBytes) {
        this.fail('transcribe-failed', null)
        return
      }
      const language = speechCatalog.selection.language
      const request: TranscriptionRequest = {
        audioBase64: audioBase64(wave),
        providerId: speechCatalog.selection.providerId,
        ...(language === 'auto' || language === '' ? {} : { language }),
      }
      const result = await this.deps.transcribe(request, runSignal)
      if (this.loopEnded(runSignal)) return
      if (!result.ok) {
        this.fail('transcribe-failed', result.error.message)
        return
      }
      const text = result.value.text.trim()
      if (!hasSpeakable(text)) return
      const echo = this.echoGuard.check(text)
      if (!echo.accepted) return
      await this.submitUtterance(text)
    } catch (error) {
      if (this.loopEnded(runSignal)) return
      this.fail('transcribe-failed', error instanceof Error ? error.message : String(error))
    } finally {
      this.busy = false
      this.recompute()
    }
  }

  private async submitUtterance(text: string): Promise<void> {
    const runSignal = this.runSignal?.signal
    if (runSignal === undefined) return
    this.cancelAssistantSpeech()
    try {
      if (this.audible || this.deps.sessionRunning()) {
        this.audible = false
        await this.deps.cancel()
      }
      await this.deps.send(text)
    } catch (error) {
      if (runSignal.aborted) return
      this.fail('submit-failed', error instanceof Error ? error.message : String(error))
    }
  }

  private readonly feedHandler: AssistantSpeechHandler = {
    onSentence: (sentenceKey: string, _attemptId: string, text: string) => {
      const runSignal = this.runSignal?.signal
      if (runSignal === undefined || runSignal.aborted || this.state.getSnapshot().muted) return
      const ttsCatalog = this.deps.tts.getSnapshot().catalog
      if (ttsCatalog === null) return
      const controller = new AbortController()
      this.synthJobs.set(sentenceKey, controller)
      this.pendingSynth += 1
      this.recompute()
      const request: SynthesisRequestWire = {
        text,
        providerId: ttsCatalog.selection.providerId,
        voiceId: ttsCatalog.selection.voiceId,
        ...(ttsCatalog.selection.language === 'auto' ? {} : { language: ttsCatalog.selection.language }),
      }
      const job = (async () => {
        await this.synthGate
        const result = await this.deps.synthesize(request, AbortSignal.any([runSignal, controller.signal]))
        if (controller.signal.aborted || runSignal.aborted) return
        if (!result.ok) throw new Error(result.error.message)
        this.playback.enqueue(sentenceKey, text, decodeBase64ToBytes(result.value.audioBase64), controller.signal)
      })()
      this.synthGate = job.then(() => undefined, () => undefined)
      const tracked = job
        .catch((error: unknown) => {
          if (!controller.signal.aborted && !runSignal.aborted) {
            this.fail('synthesize-failed', error instanceof Error ? error.message : String(error))
          }
        })
        .finally(() => {
          this.synthJobs.delete(sentenceKey)
          this.pendingSynth -= 1
          this.recompute()
        })
      this.pipelineTail = this.pipelineTail.then(async () => { await tracked })
    },
    onSettled: (attemptId: string, interrupted: boolean) => {
      if (interrupted) this.abortAttempt(attemptId)
    },
    onAbandoned: (attemptId: string) => {
      this.abortAttempt(attemptId)
    },
  }

  private abortAttempt(attemptId: string): void {
    const prefix = `${attemptId}#`
    let matched = false
    for (const [key, controller] of this.synthJobs) {
      if (key.startsWith(prefix)) {
        controller.abort()
        matched = true
      }
    }
    if (matched) this.playback.cancelAll()
  }

  private cancelAssistantSpeech(): void {
    for (const controller of this.synthJobs.values()) controller.abort()
    this.playback.cancelAll()
    this.recompute()
  }

  private recompute(): void {
    if (!this.started) return
    let phase: VoicePhase
    if (this.busy) phase = 'transcribing'
    else if (this.gateState === 'calibrating') phase = 'calibrating'
    else if (this.gateState === 'speaking' || this.gateState === 'barge-pending') phase = 'hearing'
    else if (this.playback.speaking || this.pendingSynth > 0) phase = 'speaking'
    else if (this.deps.sessionRunning()) phase = 'thinking'
    else phase = 'listening'
    this.capture.setPlaybackActive(phase === 'speaking')
    const snapshot = this.state.getSnapshot()
    if (snapshot.phase !== phase) this.setState({ ...snapshot, phase })
  }

  private failCapture(error: CaptureError): void {
    this.teardown()
    void this.capture.stop().catch(() => undefined)
    const kind: VoiceErrorKind = `capture-${error.kind}` as VoiceErrorKind
    this.setState({ ...this.state.getSnapshot(), phase: 'off', speakerWarning: false, error: { kind, message: null } })
  }

  private fail(kind: VoiceErrorKind, message: string | null): void {
    const snapshot = this.state.getSnapshot()
    this.setState({ ...snapshot, error: { kind, message } })
  }

  private clearError(): void {
    const snapshot = this.state.getSnapshot()
    if (snapshot.error !== null) this.setState({ ...snapshot, error: null })
  }

  private setState(next: VoiceUiState): void {
    this.state.set(next)
  }
}
