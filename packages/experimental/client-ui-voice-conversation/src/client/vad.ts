/**
 * Browser-independent voice activity pipeline pieces: linear resampling to
 * 16 kHz, a pre-utterance ring buffer, RMS, and an energy-gate VAD timed in
 * milliseconds so every audio backend produces the same decisions.
 */

/** Tunable gate timings; values are deployment-independent acoustics, not host configuration. */
export interface VadParams {
  /** Continuous quiet frames required to finish the initial noise calibration. */
  readonly calibrationMs: number
  /** Maximum calibration wait before proceeding with the estimate gathered so far. */
  readonly calibrationCapMs: number
  /** RMS counted as silence while calibrating, relative to {@link minStartRms}. */
  readonly calibrationRmsMultiple: number
  /** Onset threshold multiplier over the calibrated noise floor. */
  readonly startFactor: number
  /** Release threshold multiplier over the calibrated noise floor. */
  readonly releaseFactor: number
  /** Absolute onset floor so a very quiet room never makes the gate hypersensitive. */
  readonly minStartRms: number
  /** Onset threshold multiplier while the assistant is speaking (barge-in). */
  readonly bargeFactor: number
  /** Absolute barge-in floor; higher than ordinary onset to reject speaker residue. */
  readonly minBargeRms: number
  /** Continuous loud frames required to confirm barge-in over playback. */
  readonly bargeConfirmMs: number
  /** Trailing quiet time that closes an utterance. */
  readonly endSilenceMs: number
  /** Voiced time below which a closed utterance is discarded as a blip. */
  readonly minSpeechMs: number
  /** Hard utterance cap; the rest is handled as a new utterance. */
  readonly maxSpeechMs: number
  /** EMA weight for slow downward noise-floor adaptation between utterances. */
  readonly floorAdapt: number
}

/** Default timings for 20-90 ms energy frames. */
export const DEFAULT_VAD_PARAMS: VadParams = {
  calibrationMs: 500,
  calibrationCapMs: 3000,
  calibrationRmsMultiple: 2,
  startFactor: 3,
  releaseFactor: 1.8,
  minStartRms: 0.01,
  bargeFactor: 5,
  minBargeRms: 0.03,
  bargeConfirmMs: 300,
  endSilenceMs: 700,
  minSpeechMs: 250,
  maxSpeechMs: 20000,
  floorAdapt: 0.05,
}

/** Gate state exposed to callers for phase rendering. */
export type VadState = 'calibrating' | 'silence' | 'barge-pending' | 'speaking'

/** Per-frame decision emitted by {@link VadGate.update}. */
export type VadEvent =
  | { readonly type: 'calibrating' }
  | { readonly type: 'silence' }
  | { readonly type: 'barge-pending' }
  | { readonly type: 'start' }
  | { readonly type: 'speech' }
  | {
    readonly type: 'end'
    readonly reason: 'silence' | 'max-duration'
    /** Total voiced (above release) time accumulated for the utterance. */
    readonly voicedMs: number
    /** Trailing quiet time at closure, for tail trimming. */
    readonly trailingSilenceMs: number
  }

/** One fixed-size energy sample presented to the gate. */
export interface VadFrame {
  readonly rms: number
  readonly frameMs: number
  readonly playbackActive: boolean
}

/** Energy gate driven one frame at a time; all timing is explicit. */
export class VadGate {
  private readonly params: VadParams
  private state: VadState = 'calibrating'
  private floor = 0
  private quietMs = 0
  private calibMs = 0
  private sumSquares = 0
  private quietFrameCount = 0
  private speechMs = 0
  private voicedMs = 0
  private trailingSilenceMs = 0
  private bargeMs = 0

  constructor(params: VadParams = DEFAULT_VAD_PARAMS) {
    this.params = params
  }

  /** Current gate phase; changes only on an accepted frame transition. */
  get currentState(): VadState {
    return this.state
  }

  /** Calibrated noise floor RMS; zero until calibration completes. */
  get noiseFloor(): number {
    return this.floor
  }

  /** Restart calibration; used when capture starts or the input device changes. */
  reset(): void {
    this.state = 'calibrating'
    this.floor = 0
    this.quietMs = 0
    this.calibMs = 0
    this.sumSquares = 0
    this.quietFrameCount = 0
    this.speechMs = 0
    this.voicedMs = 0
    this.trailingSilenceMs = 0
    this.bargeMs = 0
  }

  /**
   * Apply one energy frame.
   * @param frame - RMS, duration and playback flag.
   * @returns state event for the frame.
   */
  update(frame: VadFrame): VadEvent {
    if (this.state === 'calibrating') return this.updateCalibrating(frame)
    if (this.state === 'barge-pending') return this.updateBargePending(frame)
    if (this.state === 'speaking') return this.updateSpeaking(frame)
    return this.updateSilence(frame)
  }

  private updateCalibrating(frame: VadFrame): VadEvent {
    this.calibMs += frame.frameMs
    const quietCeiling = this.params.minStartRms * this.params.calibrationRmsMultiple
    if (frame.rms <= quietCeiling) {
      this.quietMs += frame.frameMs
      this.sumSquares += frame.rms * frame.rms
      this.quietFrameCount += 1
    } else {
      this.quietMs = 0
    }
    if (this.quietMs >= this.params.calibrationMs) {
      this.finishCalibration()
      return { type: 'silence' }
    }
    if (this.calibMs >= this.params.calibrationCapMs) {
      this.finishCalibration()
      if (this.state === 'calibrating') return { type: 'calibrating' }
      return { type: 'silence' }
    }
    return { type: 'calibrating' }
  }

  private finishCalibration(): void {
    this.floor = this.quietFrameCount > 0 ? Math.sqrt(this.sumSquares / this.quietFrameCount) : this.params.minStartRms
    this.state = 'silence'
  }

  private updateSilence(frame: VadFrame): VadEvent {
    this.adaptFloor(frame.rms)
    const onset = frame.playbackActive
      ? Math.max(this.floor * this.params.bargeFactor, this.params.minBargeRms)
      : Math.max(this.floor * this.params.startFactor, this.params.minStartRms)
    if (frame.rms >= onset) {
      if (frame.playbackActive) {
        this.state = 'barge-pending'
        this.bargeMs = frame.frameMs
        return this.bargeMs >= this.params.bargeConfirmMs ? this.confirmBarge() : { type: 'barge-pending' }
      }
      this.beginSpeech(frame.frameMs, frame.rms)
      return { type: 'start' }
    }
    return { type: 'silence' }
  }

  private updateBargePending(frame: VadFrame): VadEvent {
    const threshold = Math.max(this.floor * this.params.bargeFactor, this.params.minBargeRms)
    if (frame.rms < threshold) {
      this.state = 'silence'
      this.bargeMs = 0
      return { type: 'silence' }
    }
    this.bargeMs += frame.frameMs
    if (this.bargeMs >= this.params.bargeConfirmMs) return this.confirmBarge()
    return { type: 'barge-pending' }
  }

  private confirmBarge(): VadEvent {
    this.beginSpeech(this.bargeMs, 0)
    this.bargeMs = 0
    return { type: 'start' }
  }

  private beginSpeech(initialMs: number, initialRms: number): void {
    this.state = 'speaking'
    this.speechMs = initialMs
    this.voicedMs = initialRms >= this.releaseThreshold() ? initialMs : 0
    this.trailingSilenceMs = 0
  }

  private updateSpeaking(frame: VadFrame): VadEvent {
    this.speechMs += frame.frameMs
    const released = frame.rms < this.releaseThreshold()
    if (released) {
      this.trailingSilenceMs += frame.frameMs
    } else {
      this.voicedMs += this.trailingSilenceMs + frame.frameMs
      this.trailingSilenceMs = 0
    }
    if (this.speechMs >= this.params.maxSpeechMs) return this.end('max-duration')
    if (this.trailingSilenceMs >= this.params.endSilenceMs) return this.end('silence')
    return { type: 'speech' }
  }

  private end(reason: 'silence' | 'max-duration'): VadEvent {
    const event: VadEvent = {
      type: 'end',
      reason,
      voicedMs: this.voicedMs,
      trailingSilenceMs: this.trailingSilenceMs,
    }
    this.state = 'silence'
    this.speechMs = 0
    this.voicedMs = 0
    this.trailingSilenceMs = 0
    return event
  }

  private releaseThreshold(): number {
    return Math.max(this.floor * this.params.releaseFactor, this.params.minStartRms)
  }

  private adaptFloor(rms: number): void {
    if (rms > this.floor * this.params.startFactor) return
    this.floor = this.floor * (1 - this.params.floorAdapt) + rms * this.params.floorAdapt
  }
}

/** Streaming linear-interpolation resampler; passes through matching rates untouched. */
export class LinearResampler {
  private readonly ratio: number
  private carry = 0
  private frac = 0

  constructor(
    private readonly fromRate: number,
    private readonly toRate: number,
  ) {
    if (!Number.isFinite(fromRate) || fromRate <= 0 || !Number.isFinite(toRate) || toRate <= 0) {
      throw new RangeError('resampler rates must be positive finite numbers')
    }
    this.ratio = fromRate / toRate
  }

  /**
   * Resample one contiguous chunk.
   * @param chunk - samples at `fromRate` belonging to one uninterrupted stream.
   * @returns samples at `toRate`; output phase carries across calls.
   */
  push(chunk: Float32Array): Float32Array {
    if (this.fromRate === this.toRate) return chunk
    const source = new Float32Array(chunk.length + 1)
    source[0] = this.carry
    source.set(chunk, 1)
    const output: number[] = []
    let position = 1 + this.frac
    while (position < chunk.length) {
      const index = Math.floor(position)
      const fraction = position - index
      output.push((source[index] as number) + ((source[index + 1] as number) - (source[index] as number)) * fraction)
      position += this.ratio
    }
    this.carry = chunk[chunk.length - 1] ?? 0
    this.frac = position - chunk.length - 1
    return Float32Array.from(output)
  }
}

/** Fixed-capacity ring keeping the most recent samples for pre-utterance padding. */
export class PreRollRing {
  private buffer: Float32Array
  private written = 0

  constructor(readonly capacitySamples: number) {
    if (capacitySamples < 0) throw new RangeError('ring capacity must be non-negative')
    this.buffer = new Float32Array(0)
  }

  /**
   * Append a chunk, dropping the oldest samples beyond the capacity.
   * @param chunk - incoming mono samples.
   */
  push(chunk: Float32Array): void {
    if (chunk.length >= this.capacitySamples) {
      this.buffer = chunk.slice(chunk.length - this.capacitySamples)
      this.written = this.capacitySamples
      return
    }
    const mergedLength = Math.min(this.capacitySamples, this.buffer.length + chunk.length)
    const merged = new Float32Array(mergedLength)
    const overflow = this.buffer.length + chunk.length - mergedLength
    const keep = this.buffer.length - overflow
    merged.set(this.buffer.subarray(this.buffer.length - keep), 0)
    merged.set(chunk, keep)
    this.buffer = merged
    this.written += chunk.length
  }

  /**
   * Snapshot the retained samples without clearing.
   * @returns copy of the currently retained pre-roll window.
   */
  snapshot(): Float32Array {
    return this.buffer.slice()
  }

  /** Drop all retained samples. */
  clear(): void {
    this.buffer = new Float32Array(0)
  }

  /** Currently retained sample count, at most the ring capacity. */
  get length(): number {
    return this.buffer.length
  }
}

/**
 * Root-mean-square amplitude of one frame.
 * @param samples - interleaved mono frame.
 * @returns RMS in 0..1.
 */
export function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.sqrt(sum / samples.length)
}

/**
 * Concatenate audio frames into one contiguous buffer.
 * @param frames - buffers in stream order.
 * @returns one buffer; empty when no frames.
 */
export function concatFrames(frames: readonly Float32Array[]): Float32Array {
  const total = frames.reduce((sum, frame) => sum + frame.length, 0)
  const merged = new Float32Array(total)
  let offset = 0
  for (const frame of frames) {
    merged.set(frame, offset)
    offset += frame.length
  }
  return merged
}
