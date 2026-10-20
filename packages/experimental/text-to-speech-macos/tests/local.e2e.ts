/** Explicit opt-in real `say` synthesis on a macOS host. */
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import TextToSpeech from '@deepseek-ai/dsh-experimental-text-to-speech'
import { expect, it, vi } from 'vitest'
import { Config } from '../src/config.ts'
import { apply } from '../src/index.ts'

const { DSH_TTS_MACOS_E2E: optIn } = process.env

it.skipIf(optIn !== '1' || process.platform !== 'darwin')('lists and speaks through the real say command', { timeout: 120_000, retry: 0 }, async () => {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocess)
  // The exact registered Tingting id is runtime-dependent; every resolve below passes it explicitly.
  await ctx.plugin(TextToSpeech, { defaultProvider: 'macos-say', defaultVoice: 'Tingting', language: 'auto' })
  const spawn = vi.spyOn(ctx.get('subprocess')!, 'spawn')
  try {
    await apply(ctx, Config({}))
    const tts = ctx.get('textToSpeech')!
    expect(tts.listProviders()).toHaveLength(1)
    expect(tts.snapshot().providers[0]!.preparation.phase).toBe('ready')
    const tingting = tts.listProviders()[0]!.voices.find(voice => voice.id.startsWith('Tingting'))
    expect(tingting).toBeDefined()
    const result = await tts.synthesize(tts.resolve({ text: '你好，这是系统语音合成测试。Hello from macOS.', voiceId: tingting!.id }), new AbortController().signal)
    expect(result.mimeType).toBe('audio/wav')
    expect(result.sampleRate).toBe(24000)
    expect(result.audio.length).toBeGreaterThan(44)
    expect(result.audioSeconds).toBeGreaterThan(1)
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(spawn.mock.calls[0]![0].argv).toEqual(['say', '-v', '?'])
    expect(spawn.mock.calls[1]![0].argv.slice(0, 3)).toEqual(['say', '-v', tingting!.id])
    console.info('macOS say synthesis', { result, voice: tingting })
  } finally {
    await ctx.fiber.dispose()
    spawn.mockRestore()
  }
})
