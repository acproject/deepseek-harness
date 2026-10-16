/** Authenticated synthesis domain methods validate text before selecting a synthesizer. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import TextToSpeech from '@deepseek-ai/dsh-experimental-text-to-speech'
import type { SynthesisProviderId } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import type { SynthesisProvider, SynthesisResult } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import TtsController from '../src/index.ts'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => root.fiber.dispose())) })
const id = 'kokoro-local' as SynthesisProviderId
const voiceId = 'zf_xiaobei'
function wav(bytes = 46): Uint8Array {
  const audio = new Uint8Array(bytes)
  audio.set([0x52, 0x49, 0x46, 0x46], 0)
  audio.set([0x57, 0x41, 0x56, 0x45], 8)
  return audio
}
function fixture(maxTextChars = 500, maxAudioBytes = 1 << 20) {
  const ctx = new Context(); roots.push(ctx)
  const tts = new TextToSpeech(ctx, TextToSpeech.Config({ defaultProvider: id, defaultVoice: voiceId, language: 'auto' }))
  const synthesize = vi.fn(async (): Promise<SynthesisResult> => ({
    audio: wav(), mimeType: 'audio/wav', sampleRate: 24000, audioSeconds: 1, synthesisSeconds: 0.4,
  }))
  tts.register({ info: { id, name: 'test', location: 'host-local',
    voices: [{ id: voiceId, name: 'Xiaobei', languages: ['auto', 'zh', 'en'] }] }, synthesize })
  return { api: new TtsController(ctx, { maxTextChars, maxAudioBytes }), synthesize }
}

it('lists limits without inference and forwards explicit provider, voice and language', async () => {
  const { api, synthesize } = fixture()
  expect(api.catalog()).toMatchObject({ selection: { providerId: id, voiceId }, maxTextChars: 500, providers: [{ id }] })
  expect(synthesize).not.toHaveBeenCalled()
  api.prepare(id)
  await api.cancelPreparation(id)
  const lifetime = new AbortController(), observation = api.follow(lifetime.signal)[Symbol.asyncIterator]()
  expect((await observation.next()).value).toMatchObject({ providers: [{ id, preparation: { phase: 'ready' } }] })
  lifetime.abort(); await observation.next()
  const result = await api.synthesize({ text: '你好', providerId: id, voiceId, language: 'zh' }, new AbortController().signal)
  expect(result).toMatchObject({ mimeType: 'audio/wav', sampleRate: 24000 })
  expect(Buffer.from(result.audioBase64, 'base64').subarray(0, 4).toString('ascii')).toBe('RIFF')
  expect(synthesize).toHaveBeenCalledWith(expect.objectContaining({ language: 'zh', voiceId }), expect.any(AbortSignal))
  await api.synthesize({ text: 'hi' }, new AbortController().signal)
  expect(synthesize).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'auto', voiceId }), expect.any(AbortSignal))
})

it('forwards an explicit download source to the registered preparation owner', async () => {
  const ctx = new Context(); roots.push(ctx)
  const tts = new TextToSpeech(ctx, TextToSpeech.Config({ defaultProvider: id, defaultVoice: voiceId }))
  const prepare = vi.fn()
  const provider: SynthesisProvider = {
    info: {
      id, name: 'local', location: 'host-local',
      voices: [{ id: voiceId, name: 'Xiaobei', languages: ['auto'] }], downloadSources: ['https://example.com'],
    },
    preparation: { snapshot: () => ({ phase: 'unprepared' }), subscribe: () => () => {}, prepare, cancel: async () => {} },
    synthesize: async () => ({ audio: wav(), mimeType: 'audio/wav', sampleRate: 24000, audioSeconds: 0, synthesisSeconds: 0 }),
  }
  tts.register(provider)
  const api = new TtsController(ctx, { maxTextChars: 500, maxAudioBytes: 1 << 20 })
  expect(api.catalog().providers[0]?.downloadSources).toEqual(['https://example.com'])
  api.prepare(id, { downloadSource: 'https://example.com' })
  expect(prepare).toHaveBeenCalledWith({ downloadSource: 'https://example.com' })
})

it('rejects empty, whitespace-only and over-long text in code points without inference', async () => {
  const { api, synthesize } = fixture(3)
  for (const text of ['', '   ', '\n\t', 'abcd', '😀😀😀😀']) {
    await expect(api.synthesize({ text }, new AbortController().signal)).rejects.toMatchObject({ code: 'tts/invalid-text' })
  }
  expect(synthesize).not.toHaveBeenCalled()
})

it('preserves cancellation and reports synthesizer failures', async () => {
  const { api, synthesize } = fixture()
  await expect(api.configure({ language: 'zh' })).rejects.toThrow('settings service')
  await expect(api.synthesize({ text: 'hi' }, AbortSignal.abort(new Error('cancel')))).rejects.toThrow('cancel')
  synthesize.mockRejectedValueOnce(new Error('offline'))
  await expect(api.synthesize({ text: 'hi' }, new AbortController().signal))
    .rejects.toMatchObject({ code: 'tts/synthesis-failed', message: 'offline' })
  synthesize.mockRejectedValueOnce('failed')
  await expect(api.synthesize({ text: 'hi' }, new AbortController().signal))
    .rejects.toMatchObject({ message: 'failed' })
})

it('rejects audio output over the Remote byte limit', async () => {
  const ctx = new Context(); roots.push(ctx)
  const tts = new TextToSpeech(ctx, TextToSpeech.Config({ defaultProvider: id, defaultVoice: voiceId }))
  const provider: SynthesisProvider = {
    info: { id, name: 'test', location: 'host-local',
      voices: [{ id: voiceId, name: 'Xiaobei', languages: ['auto'] }] },
    synthesize: async () => ({ audio: wav(100), mimeType: 'audio/wav', sampleRate: 24000, audioSeconds: 1, synthesisSeconds: 1 }),
  }
  tts.register(provider)
  const api = new TtsController(ctx, { maxTextChars: 500, maxAudioBytes: 99 })
  const rejection = api.synthesize({ text: 'hi' }, new AbortController().signal)
  await expect(rejection).rejects.toMatchObject({ code: 'tts/synthesis-failed' })
  await expect(rejection).rejects.toThrow('byte limit')
})
