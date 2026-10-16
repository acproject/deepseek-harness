/**
 * Serial TTS playback queue. Synthesized WAV clips decode lazily and play in
 * enqueue order; each job carries its own abort signal for attempt-scoped
 * cancellation, and barge-in cancels the whole queue immediately.
 */

/** Notifications for playback-state rendering and echo bookkeeping. */
export interface SpeechPlaybackHandlers {
  /** A clip started reaching the speaker. */
  onStart(text: string): void
  /** The queue drained and no clip is playing. */
  onDrain(): void
}

type JobState = 'queued' | 'playing' | 'cancelled'

interface PlayJob {
  readonly key: string
  readonly text: string
  readonly bytes: Uint8Array
  readonly signal: AbortSignal
  state: JobState
  source: AudioBufferSourceNode | undefined
}

/** Ordered audio sink for one always-on session. */
export class SpeechPlayback {
  private readonly handlers: SpeechPlaybackHandlers
  private context: AudioContext | undefined
  private jobs: PlayJob[] = []
  private pumping = false
  private disposed = false

  constructor(handlers: SpeechPlaybackHandlers) {
    this.handlers = handlers
  }

  /** Whether at least one clip is waiting or playing. */
  get speaking(): boolean {
    return this.jobs.some(job => job.state === 'queued' || job.state === 'playing')
  }

  /**
   * Append one synthesized clip.
   * @param key - sentence key used by the controller for logs.
   * @param text - text being played (echo bookkeeping happens via {@link onStart}).
   * @param bytes - WAV bytes produced by the TTS provider.
   * @param signal - aborts decode or playback when the attempt is discarded.
   */
  enqueue(key: string, text: string, bytes: Uint8Array, signal: AbortSignal): void {
    if (this.disposed || signal.aborted) return
    const job: PlayJob = { key, text, bytes: bytes.slice(), signal, state: 'queued', source: undefined }
    signal.addEventListener('abort', () => { this.cancelJob(job) }, { once: true })
    this.jobs.push(job)
    void this.pump()
  }

  /** Stop and drop every queued or playing clip immediately (barge-in). */
  cancelAll(): void {
    for (const job of this.jobs) this.cancelJob(job)
  }

  /** Release the audio context and stop playback for good. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.cancelAll()
    const context = this.context
    this.context = undefined
    if (context && context.state !== 'closed') {
      try { await context.close() } catch { /* page teardown races close */ }
    }
  }

  private cancelJob(job: PlayJob): void {
    if (job.state === 'playing') {
      try { job.source?.stop() } catch { /* already stopped */ }
    }
    job.state = 'cancelled'
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.context) this.context = new AudioContext()
    if (this.context.state === 'suspended') await this.context.resume()
    return this.context
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.disposed) return
    this.pumping = true
    try {
      while (!this.disposed) {
        const job = this.jobs.find(candidate => candidate.state === 'queued')
        if (!job) break
        if (job.signal.aborted) {
          job.state = 'cancelled'
          continue
        }
        const context = await this.ensureContext()
        let buffer: AudioBuffer
        try {
          buffer = await context.decodeAudioData(job.bytes.slice().buffer)
        } catch {
          job.state = 'cancelled'
          continue
        }
        if (job.state !== 'queued') continue
        job.state = 'playing'
        this.handlers.onStart(job.text)
        await this.play(context, job, buffer)
      }
      this.jobs = this.jobs.filter(job => job.state === 'queued' || job.state === 'playing')
    } finally {
      this.pumping = false
      if (!this.speaking) this.handlers.onDrain()
    }
  }

  private play(context: AudioContext, job: PlayJob, buffer: AudioBuffer): Promise<void> {
    return new Promise((resolve) => {
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }
      source.onended = finish
      source.start()
      job.source = source
      if (job.signal.aborted) {
        this.cancelJob(job)
      } else {
        job.signal.addEventListener('abort', () => { this.cancelJob(job) }, { once: true })
      }
    })
  }
}

const HEADPHONE_LABEL = /head\s?phone|headset|ear\s?pod|earphone|airpods|耳机/i

/**
 * Best-effort detection of a wired or wireless headphone output.
 * @returns true/false when device labels are readable; undefined when undecidable.
 */
export async function detectHeadphones(): Promise<boolean | undefined> {
  // Embedded WebViews may omit mediaDevices despite the non-optional lib.dom type.
  const devicesApi = (globalThis.navigator as { mediaDevices?: Pick<MediaDevices, 'enumerateDevices'> }).mediaDevices
  if (devicesApi === undefined || typeof devicesApi.enumerateDevices !== 'function') return undefined
  let outputs: readonly MediaDeviceInfo[]
  try {
    outputs = (await devicesApi.enumerateDevices()).filter(device => device.kind === 'audiooutput')
  } catch {
    return undefined
  }
  if (outputs.length === 0) return undefined
  if (outputs.every(device => device.label === '')) return undefined
  return outputs.some(device => HEADPHONE_LABEL.test(device.label))
}
