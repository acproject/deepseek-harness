/** Explicit opt-in real Kokoro inference, including the managed runtime when no override is supplied. */
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { expect, it, vi } from 'vitest'
import { Config } from '../src/config.ts'
import { KokoroWorker } from '../src/synthesizer.ts'

const { DSH_TTS_E2E_ROOT: dataRoot, DSH_TTS_E2E_MODEL: modelDirectory } = process.env

it.skipIf(!dataRoot)('prepares a real local synthesizer, speaks mixed text, and releases it', { timeout: 3_660_000, retry: 0 }, async () => {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocess)
  const spawn = vi.spyOn(ctx.get('subprocess')!, 'spawn')
  const worker = new KokoroWorker(ctx, Config({ dataRoot: dataRoot!,
    modelDirectory, precision: process.env.DSH_TTS_E2E_PRECISION === 'fp32' ? 'fp32' : 'int8' }))
  try {
    worker.prepare()
    await vi.waitFor(() => { expect(worker.snapshot().phase).toBe('ready') }, { timeout: 3_600_000 })
    const input = { text: '你好，我们正在测试语音合成。Hello from Kokoro.', voiceId: 'zf_xiaobei', language: 'auto' }
    const cold = await worker.synthesize(input, new AbortController().signal)
    const warm = await worker.synthesize(input, new AbortController().signal)
    expect(cold.mimeType).toBe('audio/wav')
    expect(cold.sampleRate).toBe(24000)
    expect(cold.audio.length).toBeGreaterThan(44)
    expect(cold.audioSeconds).toBeGreaterThan(1)
    expect(warm.audio.length).toBeGreaterThan(44)
    expect(warm.sampleRate).toBe(cold.sampleRate)
    expect(Math.abs(warm.audioSeconds - cold.audioSeconds)).toBeLessThan(0.2)
    await expect(worker.synthesize({ text: 'hi', voiceId: 'missing', language: 'auto' }, new AbortController().signal))
      .rejects.toThrow('Unknown Kokoro voice')
    expect(spawn).toHaveBeenCalledOnce()
    console.info('Kokoro inference', { cold, warm })
  } finally {
    await worker.dispose()
    await ctx.fiber.dispose()
    spawn.mockRestore()
  }
})
