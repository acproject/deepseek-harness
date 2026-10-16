/** Verified models accept bounded concurrent syntheses while the managed worker starts. */
import { createServer } from 'node:http'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import TextToSpeech from '@deepseek-ai/dsh-experimental-text-to-speech'
import { afterEach, expect, it, vi } from 'vitest'
import * as Provider from '../src/index.ts'
import { KokoroWorker } from '../src/synthesizer.ts'
import { inspectRuntime } from '../src/runtime.ts'
vi.mock('../src/runtime.ts', () => ({ inspectRuntime: vi.fn(), prepareRuntime: vi.fn() }))
afterEach(() => { vi.restoreAllMocks() })

async function mount(root: string, options: Record<string, unknown> = {}) {
  const ctx = new Context()
  const startupEntered = Promise.withResolvers<undefined>(), releaseStartup = Promise.withResolvers<undefined>()
  const gate = createServer((_request, response) => {
    startupEntered.resolve(undefined)
    void releaseStartup.promise.then(() => { response.end('ready') })
  })
  await new Promise<void>((resolve, reject) => { gate.once('error', reject); gate.listen(0, '127.0.0.1', resolve) })
  const address = gate.address()
  if (!address || typeof address === 'string') throw Error('Missing gate address')
  const worker = join(root, 'worker.mjs')
  const fixtureUrl = new URL('./worker.fixture.mjs', import.meta.url).href
  await writeFile(worker, `await fetch('http://127.0.0.1:${address.port}/');\nawait import(${JSON.stringify(fixtureUrl)});\n`)
  vi.mocked(inspectRuntime).mockResolvedValue({
    model: root, voices: root, tokens: root, dataDir: root, lexiconEn: root, lexiconZh: root, worker,
  })
  await ctx.plugin(LocalSubprocess)
  await ctx.plugin(TextToSpeech, { defaultProvider: 'kokoro-local', defaultVoice: 'zf_xiaobei', language: 'auto' })
  const spawn = vi.spyOn(ctx.subprocess, 'spawn')
  const enqueue = vi.spyOn(KokoroWorker.prototype, 'synthesize')
  await ctx.plugin(Provider, { dataRoot: root, idleTimeoutMs: 0, maxPending: 2, ...options })
  const tts = ctx.get('textToSpeech')!
  await vi.waitFor(() => { expect(tts.snapshot().providers[0]?.preparation.phase).toBe('standby') })
  return { ctx, tts, spawn, enqueue, gate, startupEntered, releaseStartup }
}

it.each([false, true])('queues syntheses during startup and honors waiting cancellation (%s)', async (cancelled) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-kokoro-queue-'))
  const harness = await mount(root)
  const { ctx, tts, spawn, enqueue, gate, startupEntered, releaseStartup } = harness
  try {
    const firstSpec = tts.resolve({ text: '你好' })
    const secondSpec = tts.resolve({ text: '再见' })
    const first = tts.synthesize(firstSpec, new AbortController().signal)
    const firstResult = first.then(value => ({ value }), (error: unknown) => ({ error }))
    await startupEntered.promise
    expect(tts.snapshot().providers[0]?.preparation.phase).toBe('waking')
    const waiting = new AbortController()
    const second = tts.synthesize(secondSpec, waiting.signal)
    const secondResult = second.then(value => ({ value }), (error: unknown) => ({ error }))
    await Promise.resolve()
    expect(enqueue).toHaveBeenCalledTimes(2)
    await expect(tts.synthesize(secondSpec, new AbortController().signal)).rejects.toThrow('queue is full')
    if (cancelled) waiting.abort(new Error('waiting synthesis cancelled'))
    releaseStartup.resolve(undefined)
    if (cancelled) expect(await secondResult).toMatchObject({ error: { message: 'waiting synthesis cancelled' } })
    else {
      const result = await secondResult
      expect('value' in result && result.value.mimeType).toBe('audio/wav')
    }
    const done = await firstResult
    expect('value' in done && done.value.sampleRate).toBe(24000)
    expect(await readFile(join(root, 'requests'), 'utf8')).toBe(cancelled ? 'zf_xiaobei:你好\n' : 'zf_xiaobei:你好\nzf_xiaobei:再见\n')
    expect(spawn).toHaveBeenCalledOnce()
  } finally {
    releaseStartup.resolve(undefined)
    await ctx.fiber.dispose()
    await new Promise<void>((resolve) => { gate.close(() => { resolve() }) })
    await rm(root, { recursive: true, force: true })
  }
})

it('restarts a crashed worker after a failed synthesis and recycles an idle worker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-kokoro-idle-'))
  const harness = await mount(root, { idleTimeoutMs: 30 })
  const { ctx, tts, spawn, releaseStartup, gate } = harness
  try {
    releaseStartup.resolve(undefined)
    const crashed = tts.synthesize(tts.resolve({ text: 'crash' }), new AbortController().signal)
    await expect(crashed).rejects.toThrow()
    const retried = await tts.synthesize(tts.resolve({ text: '恢复' }), new AbortController().signal)
    expect(retried.mimeType).toBe('audio/wav')
    expect(spawn).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => { expect(tts.snapshot().providers[0]?.preparation.phase).toBe('standby') })
    await tts.synthesize(tts.resolve({ text: '再来' }), new AbortController().signal)
    expect(spawn).toHaveBeenCalledTimes(3)
  } finally {
    releaseStartup.resolve(undefined)
    await ctx.fiber.dispose()
    await new Promise<void>((resolve) => { gate.close(() => { resolve() }) })
    await rm(root, { recursive: true, force: true })
  }
})
