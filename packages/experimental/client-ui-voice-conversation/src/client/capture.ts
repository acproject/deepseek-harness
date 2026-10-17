/**
 * Always-on microphone capture. A native-rate stream is resampled to 16 kHz
 * mono and fed to the energy VAD; closed utterances are delivered as Float32
 * frames with pre-roll and tail padding. AudioWorklet is preferred, with a
 * ScriptProcessor fallback for runtimes without worklet support.
 */
import {
  computeRms,
  concatFrames,
  DEFAULT_VAD_PARAMS,
  LinearResampler,
  PreRollRing,
  VadGate,
  type VadEvent,
  type VadState,
} from './vad.ts'

const TARGET_SAMPLE_RATE = 16000
/** Native frames accumulated inside the worklet before one post. */
const WORKLET_FRAME_COUNT = 1024
const SCRIPT_FRAME_COUNT = 4096
/** Pre-utterance context retained for segmentation. */
const PRE_ROLL_MS = 250
/** Trailing context kept after the closing silence. */
const TAIL_PAD_MS = 250

const WORKLET_SOURCE = `
class DshVoiceFrameProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(${WORKLET_FRAME_COUNT})
    this.offset = 0
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    for (let i = 0; i < channel.length; i += 1) {
      this.buffer[this.offset] = channel[i]
      this.offset += 1
      if (this.offset === ${WORKLET_FRAME_COUNT}) {
        this.port.postMessage(this.buffer.slice())
        this.offset = 0
      }
    }
    return true
  }
}
registerProcessor('dsh-voice-frame', DshVoiceFrameProcessor)
`

/** Capture failure localized by the caller; kinds mirror the push-to-talk plugin. */
export class CaptureError extends Error {
  constructor(readonly kind: 'unavailable' | 'permission' | 'deviceMissing' | 'interrupted') {
    super(kind)
    this.name = 'CaptureError'
  }
}

/** Callbacks continuous capture emits: levels, gate transitions, closed utterances and failures. */
export interface CaptureHandlers {
  /** Latest RMS level for UI rendering. */
  onLevel(rms: number): void
  /** Utterance onset confirmed, including barge-in over playback. */
  onSegmentStart(): void
  /** VAD state transition, for phase rendering. */
  onGateState(state: VadState): void
  /** One closed utterance at 16 kHz mono. */
  onSegment(samples: Float32Array): void
  /** Capture device failed; ownership has already been released. */
  onError(error: CaptureError): void
}

/** Start request for one continuous capture session. */
export interface CaptureStartOptions {
  /** Preferred microphone device id; empty follows the system default. */
  readonly deviceId: string
  /** Host-side maximum utterance length in seconds. */
  readonly maxDurationSeconds: number
}

/** One acquired microphone stream and its VAD-driven segment assembly. */
export class AlwaysOnCapture {
  private readonly handlers: CaptureHandlers
  private stream: MediaStream | undefined
  private context: AudioContext | undefined
  private node: AudioNode | undefined
  private workletUrl: string | undefined
  private gate: VadGate | undefined
  private resampler: LinearResampler | undefined
  private ring: PreRollRing | undefined
  private utterance: Float32Array[] = []
  private level = 0
  private playbackActive = false
  private stopped = false
  private lastGateState: VadState | undefined

  constructor(handlers: CaptureHandlers) {
    this.handlers = handlers
  }

  /** Whether capture owns a live microphone stream. */
  get active(): boolean {
    return this.context !== undefined && !this.stopped
  }

  /**
   * Latest RMS level in 0..1.
   * @returns smoothed input amplitude for the current frame.
   */
  amplitude(): number {
    return this.level
  }

  /**
   * Acquire the microphone and start continuous segmentation.
   * @param options - device and host limits.
   */
  async start(options: CaptureStartOptions): Promise<void> {
    // A previous session's stop()/failInterrupted() leaves `stopped` set; reuse of this instance
    // requires clearing it before acquisition so the mid-start concurrency check stays meaningful.
    this.stopped = false
    // Some embedded WebViews ship without mediaDevices despite the non-optional lib.dom type.
    const devices = (globalThis.navigator as { mediaDevices?: MediaDevices }).mediaDevices
    if (devices === undefined) throw new CaptureError('unavailable')
    let stream: MediaStream
    try {
      stream = await devices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(options.deviceId === '' ? {} : { deviceId: { exact: options.deviceId } }),
        },
        video: false,
      })
    } catch (error) {
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError' || error.name === 'SecurityError') throw new CaptureError('permission')
        if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') throw new CaptureError('deviceMissing')
      }
      throw error
    }
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- stop() can set the flag while getUserMedia is awaited.
    if (this.stopped) {
      stream.getTracks().forEach((track) => { track.stop() })
      throw new CaptureError('interrupted')
    }
    this.stream = stream
    try {
      const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE })
      if (context.state === 'suspended') await context.resume()
      this.context = context
      const maxSpeechMs = Math.max(1000, Math.min(60000, Math.round(options.maxDurationSeconds * 1000)))
      this.gate = new VadGate({ ...DEFAULT_VAD_PARAMS, maxSpeechMs })
      this.resampler = new LinearResampler(context.sampleRate, TARGET_SAMPLE_RATE)
      this.ring = new PreRollRing((PRE_ROLL_MS * TARGET_SAMPLE_RATE) / 1000)
      const source = context.createMediaStreamSource(stream)
      this.node = await this.connectProcessor(context, source)
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', () => { this.failInterrupted() }, { once: true })
      }
    } catch (error) {
      await this.release()
      throw error
    }
  }

  private async connectProcessor(context: AudioContext, source: MediaStreamAudioSourceNode): Promise<AudioNode> {
    // Older runtimes miss AudioWorklet even though lib.dom marks it present; feature-detect both halves
    // through a deliberately loose structural view instead of AudioContext's required members.
    const factory: {
      audioWorklet?: { addModule(url: string): Promise<void> }
      createAudioWorkletNode?(name: string): AudioWorkletNode
    } = context
    const audioWorklet = factory.audioWorklet
    if (audioWorklet !== undefined && typeof factory.createAudioWorkletNode === 'function') {
      try {
        const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }))
        this.workletUrl = url
        await audioWorklet.addModule(url)
        const node = factory.createAudioWorkletNode('dsh-voice-frame')
        node.port.onmessage = (event: MessageEvent<Float32Array>) => { this.handleChunk(event.data) }
        source.connect(node)
        return node
      } catch {
        this.revokeWorkletUrl()
      }
    }
    return this.connectScriptProcessor(context, source)
  }

  private connectScriptProcessor(context: AudioContext, source: MediaStreamAudioSourceNode): AudioNode {
    // oxlint-disable-next-line typescript/no-deprecated -- deliberate fallback for runtimes without AudioWorklet.
    const processor = context.createScriptProcessor(SCRIPT_FRAME_COUNT, 1, 1)
    // oxlint-disable-next-line typescript/no-deprecated -- only event available on the legacy fallback node.
    processor.onaudioprocess = (event) => {
      // oxlint-disable-next-line typescript/no-deprecated -- inputBuffer is the legacy event's audio carrier.
      this.handleChunk(event.inputBuffer.getChannelData(0).slice())
    }
    const mute = context.createGain()
    mute.gain.value = 0
    processor.connect(mute)
    mute.connect(context.destination)
    source.connect(processor)
    return processor
  }

  /**
   * Tell the gate whether the assistant is physically speaking, so onset uses
   * the stricter barge-in threshold.
   * @param active - true while TTS audio reaches the speaker.
   */
  setPlaybackActive(active: boolean): void {
    this.playbackActive = active
  }

  private handleChunk(nativeChunk: Float32Array): void {
    const gate = this.gate
    const resampler = this.resampler
    const ring = this.ring
    if (!gate || !resampler || !ring || this.stopped) return
    const chunk = resampler.push(nativeChunk)
    if (chunk.length === 0) return
    const rms = computeRms(chunk)
    this.level = rms
    this.handlers.onLevel(rms)
    ring.push(chunk)
    const event: VadEvent = gate.update({ rms, frameMs: (chunk.length / TARGET_SAMPLE_RATE) * 1000, playbackActive: this.playbackActive })
    if (gate.currentState !== this.lastGateState) {
      this.lastGateState = gate.currentState
      this.handlers.onGateState(gate.currentState)
    }
    if (event.type === 'start') {
      this.utterance = [ring.snapshot()]
      ring.clear()
      this.handlers.onSegmentStart()
    } else if (gate.currentState === 'speaking') {
      this.utterance.push(chunk)
    }
    if (event.type === 'end') {
      ring.clear()
      this.closeUtterance(event)
    }
  }

  private closeUtterance(event: Extract<VadEvent, { type: 'end' }>): void {
    const frames = this.utterance
    this.utterance = []
    if (event.voicedMs < DEFAULT_VAD_PARAMS.minSpeechMs) return
    const padSamples = (TAIL_PAD_MS * TARGET_SAMPLE_RATE) / 1000
    const silenceSamples = (event.trailingSilenceMs * TARGET_SAMPLE_RATE) / 1000
    const keep = concatFrames(frames)
    const drop = Math.max(0, Math.round(silenceSamples - padSamples))
    const trimmed = drop > 0 ? keep.subarray(0, Math.max(1, keep.length - drop)) : keep
    this.handlers.onSegment(new Float32Array(trimmed))
  }

  private failInterrupted(): void {
    if (this.stopped) return
    void this.release()
    this.handlers.onError(new CaptureError('interrupted'))
  }

  /** Release microphone, audio graph and worklet module URL. */
  async stop(): Promise<void> {
    this.stopped = true
    await this.release()
  }

  private async release(): Promise<void> {
    this.node?.disconnect()
    this.node = undefined
    this.lastGateState = undefined
    this.stream?.getTracks().forEach((track) => { track.stop() })
    this.stream = undefined
    const context = this.context
    this.context = undefined
    this.utterance = []
    this.level = 0
    this.revokeWorkletUrl()
    if (context && context.state !== 'closed') {
      try { await context.close() } catch { /* closing during page teardown is best effort */ }
    }
  }

  private revokeWorkletUrl(): void {
    if (this.workletUrl !== undefined) {
      URL.revokeObjectURL(this.workletUrl)
      this.workletUrl = undefined
    }
  }
}
