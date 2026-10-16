/** Provider routing, voice validation, cancellation, and fiber-owned registration lifetimes. */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { describe, expect, it, vi } from 'vitest'
import TextToSpeech from '../src/index.ts'
import type { SynthesisPreparationState, SynthesisProvider, SynthesisProviderId, SynthesisResult, SynthesisVoice } from '../src/types.ts'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

const result: SynthesisResult = {
  audio: new Uint8Array([1, 2]), mimeType: 'audio/wav', sampleRate: 24000, audioSeconds: 0.1, synthesisSeconds: 0.2,
}
const text = 'hello'
const input = new AbortController().signal
const zhVoice: SynthesisVoice = { id: 'zf_xiaobei', name: 'Xiaobei', languages: ['auto', 'zh', 'en'], gender: 'female' }
const enVoice: SynthesisVoice = { id: 'af_heart', name: 'Heart', languages: ['auto', 'en'], gender: 'female' }
function provider(id: string, voices: readonly SynthesisVoice[] = [zhVoice],
  synthesize: SynthesisProvider['synthesize'] = async () => result): SynthesisProvider {
  return { info: { id: id as SynthesisProviderId, name: id, location: 'host-local', voices }, synthesize }
}

/** Mount the service behind Loader with a settings stub that writes patches back into its live entry config. */
async function mounted(ctx: Context, config: object) {
  const live = await liveConfig(ctx, TextToSpeech, config)
  const writes: object[] = []
  ctx.provide('settings', { update: async (_entry: string, patch: Record<string, unknown>) => { writes.push(patch); await live.update(patch) } } as never)
  return { tts: ctx.get('textToSpeech')!, writes, live }
}

it('shares Host preparation across observers and does not cancel work when observation ends', async () => {
  const ctx = new Context(), base = ctx.plugin(TextToSpeech, { defaultProvider: 'kokoro-local', defaultVoice: 'zf_xiaobei', language: 'auto' })
  await base
  try {
    const service = ctx.get('textToSpeech')!, id = 'local' as SynthesisProviderId
    let state: SynthesisPreparationState = { phase: 'unprepared' }, notify = (): void => {}
    const prepare = vi.fn(), cancel = vi.fn(async () => {}), unsubscribe = vi.fn()
    const remove = service.register({ ...provider(id), preparation: {
      snapshot: () => state, prepare, cancel, subscribe: (listener) => { notify = listener; return unsubscribe },
    } })
    const lifetime = new AbortController(), stream = service.follow(lifetime.signal)[Symbol.asyncIterator]()
    expect((await stream.next()).value).toMatchObject({ providers: [{ id, preparation: { phase: 'unprepared' } }] })
    service.prepare(id)
    expect(prepare).toHaveBeenCalledOnce()
    service.prepare(id, { downloadSource: 'https://mirror.example' })
    expect(prepare).toHaveBeenLastCalledWith({ downloadSource: 'https://mirror.example' })
    const next = stream.next()
    state = { phase: 'downloading', resource: 'model', completedBytes: 638, totalBytes: 936 }; notify()
    expect((await next).value).toMatchObject({ providers: [{ preparation: state }] })
    lifetime.abort()
    expect((await stream.next()).done).toBe(true)
    expect(cancel).not.toHaveBeenCalled()
    await service.cancelPreparation(id)
    expect(cancel).toHaveBeenCalledOnce()
    await remove()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(() => { service.prepare(id) }).toThrow('unavailable')
    await expect(service.cancelPreparation(id)).rejects.toThrow('unavailable')
    await expect(service.follow(lifetime.signal)[Symbol.asyncIterator]().next()).rejects.toThrow()
  } finally { await base.dispose() }
})

it('persists explicit provider, voice and language changes through the profile and publishes them with readiness', async () => {
  const ctx = new Context()
  try {
    const { tts, writes } = await mounted(ctx, { defaultProvider: 'kokoro-local', defaultVoice: 'zf_xiaobei', language: 'auto' })
    tts.register(provider('kokoro-local')); tts.register(provider('cloud', [enVoice]))
    const stream = tts.follow(new AbortController().signal)[Symbol.asyncIterator]()
    expect((await stream.next()).value).toMatchObject({ selection: { providerId: 'kokoro-local', voiceId: 'zf_xiaobei', language: 'auto' } })
    const next = stream.next()
    await tts.configure({ providerId: 'cloud' as SynthesisProviderId, voiceId: 'af_heart' })
    expect((await next).value).toMatchObject({ selection: { providerId: 'cloud', voiceId: 'af_heart', language: 'auto' } })
    await tts.configure({ language: 'en' })
    expect(tts.snapshot().selection).toEqual({ providerId: 'cloud', voiceId: 'af_heart', language: 'en' })
    expect(tts.resolve({ text })).toMatchObject({ provider: { info: { id: 'cloud' } }, voiceId: 'af_heart', language: 'en' })
    expect(writes).toEqual([{ defaultProvider: 'cloud', defaultVoice: 'af_heart' }, { language: 'en' }])
    await expect(tts.configure({ providerId: 'missing' as SynthesisProviderId })).rejects.toThrow('unavailable')
    await expect(tts.configure({ voiceId: 'missing' })).rejects.toThrow('no voice')
    await expect(tts.configure({ language: '' })).rejects.toThrow()
    expect(tts.snapshot().selection).toEqual({ providerId: 'cloud', voiceId: 'af_heart', language: 'en' })
  } finally { await ctx.fiber.dispose() }
})

it('refuses to configure without the settings service or a profile entry', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(TextToSpeech, { defaultProvider: 'local', defaultVoice: 'zf_xiaobei', language: 'auto' })
    const tts = ctx.get('textToSpeech')!
    tts.register(provider('local'))
    await expect(tts.configure({ language: 'zh' })).rejects.toThrow('settings service')
    ctx.provide('settings', { update: vi.fn() } as never)
    await expect(tts.configure({ language: 'zh' })).rejects.toThrow('profile entry')
    expect(tts.snapshot().selection).toEqual({ providerId: 'local', voiceId: 'zf_xiaobei', language: 'auto' })
  } finally { await ctx.fiber.dispose() }
})

it('ends waiting observers and rejects registration after service disposal', async () => {
  const ctx = new Context(), base = ctx.plugin(TextToSpeech, { defaultProvider: 'kokoro-local', defaultVoice: 'zf_xiaobei', language: 'auto' })
  await base
  const service = ctx.get('textToSpeech')!, stream = service.follow(new AbortController().signal)[Symbol.asyncIterator]()
  await stream.next()
  const waiting = stream.next()
  await base.dispose()
  expect((await waiting).done).toBe(true)
  expect(() => service.register(provider('late'))).toThrow('disposed')
})

describe('synthesis providers', () => {
  it('resolves composition defaults and explicit provider choices without fallback', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', defaultVoice: 'zf_xiaobei', language: 'zh' })
    await base
    const service = ctx.get('textToSpeech')!
    const a = provider('local'), b = provider('cloud', [enVoice])
    const removeA = service.register(a), removeB = service.register(b)
    expect(service.listProviders()).toEqual([a.info, b.info])
    const spec = service.resolve({ text })
    expect(spec).toEqual({ text, language: 'zh', voiceId: 'zf_xiaobei', provider: a })
    expect(service.resolve({ text, providerId: b.info.id, voiceId: 'af_heart', language: 'en' }))
      .toEqual({ text, language: 'en', voiceId: 'af_heart', provider: b })
    expect(await service.synthesize(spec, input)).toEqual(result)
    expect(() => service.register(a)).toThrow('already registered')
    expect(() => service.resolve({ text, providerId: 'missing' as SynthesisProviderId })).toThrow('unavailable')
    await removeA(); await removeA()
    await expect(service.synthesize(spec, input)).rejects.toThrow('no longer registered')
    await removeB(); await base.dispose()
  })

  it('withdraws a provider before joining accepted work and keeps a replacement registration', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', defaultVoice: 'zf_xiaobei', language: 'auto' })
    await base
    const service = ctx.get('textToSpeech')!
    let enter!: () => void
    const entered = new Promise<void>((resolve) => { enter = resolve })
    const p = provider('local', [zhVoice], async (_value, signal) => {
      enter()
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      return result
    })
    const remove = service.register(p)
    const operation = service.synthesize(service.resolve({ text }), input)
    const rejection = expect(operation).rejects.toThrow('unloaded')
    await entered
    const removing = remove()
    expect(service.listProviders()).toEqual([])
    const next = provider('local')
    const removeNext = service.register(next)
    await removing; await rejection; await remove()
    expect(service.listProviders()).toEqual([next.info])
    await removeNext(); await base.dispose()
  })

  it('rejects pre-aborted and withdrawn queued work before the synthesizer starts', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'local', defaultVoice: 'zf_xiaobei', language: 'auto' })
    await base
    const service = ctx.get('textToSpeech')!
    let calls = 0
    const remove = service.register(provider('local', [zhVoice], async () => { calls++; return result }))
    const spec = service.resolve({ text })
    await expect(service.synthesize(spec, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
    const run = service.synthesize(spec, input)
    const rejected = expect(run).rejects.toThrow('unloaded')
    await remove(); await rejected
    expect(calls).toBe(0)
    await base.dispose()
  })

  it('removes a registration with its contributing fiber', async () => {
    const ctx = new Context()
    const base = ctx.plugin(TextToSpeech, { defaultProvider: 'kokoro-local', defaultVoice: 'zf_xiaobei', language: 'auto' })
    await base
    const fiber = ctx.inject(['textToSpeech'], (owner) => {
      owner.effect(() => owner.textToSpeech.register(provider('kokoro-local')))
    })
    await fiber
    expect(ctx.get('textToSpeech')!.listProviders()).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.get('textToSpeech')!.listProviders()).toEqual([])
    await base.dispose()
  })
})

it('rejects voices and languages unsupported by the selected provider before persistence or synthesis', async () => {
  const ctx = new Context()
  try {
    const { tts, writes } = await mounted(ctx, { defaultProvider: 'local', defaultVoice: 'af_heart', language: 'auto' })
    const synthesize = vi.fn(async () => result)
    tts.register(provider('local', [enVoice], synthesize))
    const zh = provider('zh', [{ ...enVoice, languages: ['zh'] }], synthesize)
    tts.register(zh)
    await expect(tts.configure({ language: 'zh' })).rejects.toThrow('does not support language')
    await expect(tts.configure({ providerId: zh.info.id })).rejects.toThrow('does not support language')
    await expect(tts.configure({ voiceId: 'zf_xiaobei' })).rejects.toThrow('no voice')
    expect(writes).toEqual([])
    expect(() => tts.resolve({ text, language: 'zh' })).toThrow('does not support language')
    expect(synthesize).not.toHaveBeenCalled()
    await tts.configure({ providerId: zh.info.id, language: 'zh' })
    expect(tts.resolve({ text })).toMatchObject({ provider: { info: { id: 'zh' } }, voiceId: 'af_heart', language: 'zh' })
  } finally { await ctx.fiber.dispose() }
})

it('requires the composition to choose its default provider and voice', () => {
  expect(() => z.resolve({}, TextToSpeech.Config, {})).toThrow()
  expect(() => z.resolve({ defaultProvider: 'custom' }, TextToSpeech.Config, {})).toThrow()
  const resolved = TextToSpeech.Config({ defaultProvider: 'custom', defaultVoice: 'v1', language: 'auto' })
  expect([resolved.defaultProvider.get(), resolved.defaultVoice.get(), resolved.language.get()]).toEqual(['custom', 'v1', 'auto'])
})

it('ends observers when the service unloads after a persisted selection', async () => {
  const ctx = new Context()
  try {
    const { tts, live } = await mounted(ctx, { defaultProvider: 'local', defaultVoice: 'zf_xiaobei', language: 'auto' })
    tts.register(provider('local'))
    await tts.configure({ language: 'zh' })
    const stream = tts.follow(new AbortController().signal)[Symbol.asyncIterator]()
    expect((await stream.next()).value).toMatchObject({ selection: { language: 'zh' } })
    const waiting = stream.next()
    await live.fiber.dispose()
    expect(await waiting).toEqual({ done: true, value: undefined })
  } finally { await ctx.fiber.dispose() }
})
