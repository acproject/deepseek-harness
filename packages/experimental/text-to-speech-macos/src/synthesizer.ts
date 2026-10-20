/** One macOS `say` process per request, with unconditional temporary-file cleanup. */
import { randomBytes } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SynthesisInput, SynthesisResult } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import { deadline } from '@deepseek-ai/dsh-timeout'
import type { Config } from './config.ts'
import { SynthesisInputError, validateText } from './input.ts'
import type { MacosVoice } from './voices.ts'

/** Read one four-byte RIFF chunk identifier. */
function tag(view: DataView, offset: number): string {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3))
}

/**
 * Validate canonical mono PCM16 WAV bytes and measure the audio duration.
 * Unknown chunks (for example `FLLR`) are skipped by their declared size.
 * @param audio - complete WAV file bytes produced by `say`.
 * @param sampleRate - configured output sample rate in hertz.
 * @returns produced audio duration in seconds.
 */
export function validateWav(audio: Uint8Array, sampleRate: number): number {
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength)
  if (audio.byteLength < 12 || tag(view, 0) !== 'RIFF' || tag(view, 8) !== 'WAVE') throw new Error('macOS speech produced invalid WAV audio')
  let offset = 12
  let sawFormat = false
  let dataBytes: number | undefined
  while (offset + 8 <= audio.byteLength) {
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (body + size > audio.byteLength) throw new Error('macOS speech produced invalid WAV audio')
    if (tag(view, offset) === 'fmt ') {
      if (size < 16
        || view.getUint16(body, true) !== 1
        || view.getUint16(body + 2, true) !== 1
        || view.getUint32(body + 4, true) !== sampleRate
        || view.getUint16(body + 14, true) !== 16) {
        throw new Error(`macOS speech produced WAV audio that is not mono PCM16 at ${sampleRate} hertz`)
      }
      sawFormat = true
    } else if (tag(view, offset) === 'data') {
      dataBytes = size
    }
    offset = body + size + (size % 2)
  }
  if (!sawFormat || dataBytes === undefined) throw new Error('macOS speech produced invalid WAV audio')
  return dataBytes / 2 / sampleRate
}

/** Spawn one `say` process per request; every exit path removes the temporary WAV file. */
export class SaySynthesizer {
  private readonly voiceIds: ReadonlySet<string>

  constructor(private readonly ctx: Context, private readonly config: Config, voices: readonly MacosVoice[]) {
    this.voiceIds = new Set(voices.map(voice => voice.id))
  }

  /**
   * Synthesize one complete text through a fresh `say` process.
   * @param input - bounded text and voice selection.
   * @param signal - caller or registration cancellation; rejection follows temporary-file cleanup.
   * @returns canonical WAV audio and measured durations.
   */
  async synthesize(input: SynthesisInput, signal: AbortSignal): Promise<SynthesisResult> {
    validateText(input.text, this.config.maxTextChars)
    if (!this.voiceIds.has(input.voiceId)) throw new SynthesisInputError(`Unknown macOS voice: ${input.voiceId}`)
    signal.throwIfAborted()
    const wavPath = join(tmpdir(), `dsh-tts-macos-${randomBytes(8).toString('hex')}.wav`)
    const startedAt = performance.now()
    try {
      using call = deadline(signal, this.config.synthesisTimeoutMs, 'TTS_MACOS_SYNTHESIS_TIMEOUT')
      const handle = this.ctx.subprocess.spawn({
        argv: this.argv(input.voiceId, wavPath),
        cwd: tmpdir(),
        graceMs: this.config.graceMs,
        signal: call.signal,
        stdio: { stdin: { data: input.text }, stdout: 'inherit', stderr: { maxBytes: this.config.maxLogBytes } },
      })
      const outcome = await handle.done
      call.signal.throwIfAborted()
      if (outcome.exitCode !== 0) {
        const detail = handle.collected.stderr?.readFrom(0).text.trim()
        throw new Error(`macOS speech synthesis failed (exit code ${outcome.exitCode ?? 'null'}, signal ${outcome.signal})${detail ? `: ${detail}` : ''}`)
      }
      const audio = await readFile(wavPath).catch(() => { throw new Error('macOS speech synthesis wrote no audio output') })
      if (audio.byteLength > this.config.maxAudioBytes) throw new Error('Synthesized audio exceeded its byte limit')
      const bytes = new Uint8Array(audio)
      const audioSeconds = validateWav(bytes, this.config.sampleRate)
      return { audio: bytes, mimeType: 'audio/wav', sampleRate: this.config.sampleRate, audioSeconds,
        synthesisSeconds: (performance.now() - startedAt) / 1000 }
    } finally {
      await rm(wavPath, { force: true })
    }
  }

  /**
   * Build the `say` argument vector; `-f -` reads the text from standard input so
   * request text is never interpreted as command-line options.
   * @param voiceId - exact `-v` voice name from the catalog.
   * @param wavPath - temporary output file receiving the WAV audio.
   * @returns the complete argument vector.
   */
  private argv(voiceId: string, wavPath: string): readonly string[] {
    return [this.config.command, '-v', voiceId, '--file-format=WAVE', `--data-format=LEI16@${this.config.sampleRate}`, '--channels=1',
      ...this.config.rateWpm === undefined ? [] : ['-r', String(this.config.rateWpm)],
      '-o', wavPath, '-f', '-']
  }
}
