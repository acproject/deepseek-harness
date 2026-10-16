/** CPU Kokoro inference and PCM16 WAV encoding, confined to the synthesis process. */
import { createRequire } from 'node:module'
import type { Config } from './config.ts'
import { kokoroVoice, kokoroVoices } from './voices.ts'
import { SynthesisInputError, validateText } from './input.ts'

/** Verified files and validated inference settings sent by the Host. */
export interface InferenceConfig extends Config {
  readonly model: string
  readonly voices: string
  readonly tokens: string
  readonly dataDir: string
  readonly lexiconEn: string
  readonly lexiconZh: string
}

/** Audio returned by one synchronous native generation. */
export interface SynthesizedSpeech {
  readonly audio: Buffer
  readonly sampleRate: number
  readonly audioSeconds: number
  readonly synthesisSeconds: number
}

interface NativeResult {
  samples: Float32Array
  sampleRate: number
}

interface NativeTts {
  readonly numSpeakers: number
  readonly sampleRate: number
  generate(input: { text: string; sid: number; speed: number }): NativeResult
}

interface Sherpa {
  OfflineTts: new (config: object) => NativeTts
}

/**
 * Encode mono float samples as canonical 16 kHz-family PCM16 WAV bytes.
 * @param samples - native samples nominally in [-1, 1].
 * @param sampleRate - native output rate, 24000 Hz for Kokoro.
 * @returns a 44-byte WAV header followed by little-endian PCM data.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * 2
  const audio = Buffer.allocUnsafe(44 + dataBytes)
  audio.write('RIFF', 0, 'ascii')
  audio.writeUInt32LE(36 + dataBytes, 4)
  audio.write('WAVE', 8, 'ascii')
  audio.write('fmt ', 12, 'ascii')
  audio.writeUInt32LE(16, 16)
  audio.writeUInt16LE(1, 20)
  audio.writeUInt16LE(1, 22)
  audio.writeUInt32LE(sampleRate, 24)
  audio.writeUInt32LE(sampleRate * 2, 28)
  audio.writeUInt16LE(2, 32)
  audio.writeUInt16LE(16, 34)
  audio.write('data', 36, 'ascii')
  audio.writeUInt32LE(dataBytes, 40)
  let offset = 44
  for (const sample of samples) {
    const value = Math.max(-1, Math.min(1, sample))
    audio.writeInt16LE(value < 0 ? value * 0x8000 : value * 0x7fff, offset)
    offset += 2
  }
  return audio
}

/**
 * Load one native Kokoro model; voice ids are validated against the loaded speaker table.
 * @param config - verified model paths and explicit CPU limits.
 * @returns synchronous synthesis confined to its dedicated process.
 */
export function createSynthesizer(config: InferenceConfig): (text: string, voiceId: string) => SynthesizedSpeech {
  // sherpa-onnx-node publishes a CommonJS Node-API binding with JSDoc but no declarations.
  const sherpa = createRequire(import.meta.url)('sherpa-onnx-node') as Sherpa
  const tts = new sherpa.OfflineTts({
    maxNumSentences: 1,
    model: {
      kokoro: {
        model: config.model, voices: config.voices, tokens: config.tokens,
        dataDir: config.dataDir, lexicon: `${config.lexiconEn},${config.lexiconZh}`,
      },
      numThreads: config.threads, debug: 0, provider: 'cpu',
    },
  })
  for (const voice of kokoroVoices) {
    if (voice.sid >= tts.numSpeakers) {
      throw new Error(`Kokoro voice ${voice.id} (sid ${voice.sid}) is outside the loaded model's ${tts.numSpeakers} speakers`)
    }
  }
  return (text, voiceId) => {
    validateText(text, config.maxTextChars)
    const voice = kokoroVoice(voiceId)
    if (!voice) throw new SynthesisInputError(`Unknown Kokoro voice: ${voiceId}`)
    const started = performance.now()
    const generated = tts.generate({ text, sid: voice.sid, speed: config.speed })
    const synthesisSeconds = (performance.now() - started) / 1000
    const audio = encodeWav(generated.samples, generated.sampleRate)
    if (audio.byteLength > config.maxAudioBytes) throw new SynthesisInputError('Synthesized speech exceeds the worker byte limit')
    return {
      audio, sampleRate: generated.sampleRate,
      audioSeconds: generated.samples.length / generated.sampleRate, synthesisSeconds,
    }
  }
}
