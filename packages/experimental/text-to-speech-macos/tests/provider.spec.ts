/** Provider registration reads the `say` voice catalog, synthesizes, and unregisters cleanly. */
import { writeFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import TextToSpeech from '@deepseek-ai/dsh-experimental-text-to-speech'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, expect, it, vi } from 'vitest'
import * as Provider from '../src/index.ts'
import { assertDarwinHost } from '../src/platform.ts'
import { outputPath, wav } from './fixtures.ts'

vi.mock('../src/platform.ts', () => ({ assertDarwinHost: vi.fn() }))
afterEach(() => { vi.restoreAllMocks() })

const VOICE = 'Tingting (中文（中国大陆）)'
const CATALOG = [
  `${VOICE}    zh_CN    # 你好！我叫婷婷。`,
  'Meijia    zh_TW    # 您好，我叫美佳。',
  'Alex    en_US    # Most people recognize me by my voice.',
  'Thomas    de_DE    # Hallo, ich bin Thomas.',
].join('\n')

/** One settled handle with optional collected stream text. */
function handle(outcome: SubprocessOutcome, streams: { stdout?: string; stderr?: string } = {}): SubprocessHandle {
  const reader = (text: string) => ({ readFrom: () => ({ text, nextOffset: text.length, lossy: false }) })
  return {
    stdin: undefined, stdout: undefined, stderr: undefined, control: undefined,
    collected: { ...streams.stdout === undefined ? {} : { stdout: reader(streams.stdout) },
      ...streams.stderr === undefined ? {} : { stderr: reader(streams.stderr) } },
    done: Promise.resolve(outcome), terminate: () => {}, waitForExit: () => Promise.resolve(true),
  }
}

/** Mount the Host registry with a mocked `say` subprocess; every spawn is recorded. */
async function mount(listing: SubprocessHandle) {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocess)
  await ctx.plugin(TextToSpeech, { defaultProvider: 'macos-say', defaultVoice: VOICE, language: 'auto' })
  const specs: SubprocessSpawnSpec[] = []
  vi.spyOn(ctx.get('subprocess')!, 'spawn').mockImplementation((spec) => {
    specs.push(spec)
    if (spec.argv[2] === '?') return listing
    writeFileSync(outputPath(spec), wav())
    return handle({ exitCode: 0, signal: null })
  })
  return { ctx, specs, tts: ctx.get('textToSpeech')! }
}

it('registers the catalog, synthesizes through the resolved provider, and unregisters', async () => {
  const { ctx, specs, tts } = await mount(handle({ exitCode: 0, signal: null }, { stdout: CATALOG }))
  try {
    const fiber = ctx.plugin(Provider, {})
    await fiber
    expect(specs.map(spec => spec.argv.slice(0, 3))).toEqual([['say', '-v', '?']])
    expect(tts.listProviders()).toMatchObject([{ id: 'macos-say', name: 'macOS System Speech (say)', location: 'host-local' }])
    expect(tts.snapshot().selection).toEqual({ providerId: 'macos-say', voiceId: VOICE, language: 'auto' })
    const provider = tts.snapshot().providers[0]!
    expect(provider.preparation.phase).toBe('ready')
    // Default locales are zh and en, so the German catalog voice is filtered out.
    expect(provider.voices.map(voice => voice.id)).toEqual([VOICE, 'Meijia', 'Alex'])
    const result = await tts.synthesize(tts.resolve({ text: '你好' }), new AbortController().signal)
    expect(result.mimeType).toBe('audio/wav')
    expect(specs[1]!.stdio.stdin).toEqual({ data: '你好' })
    await fiber.dispose()
    expect(tts.listProviders()).toEqual([])
  } finally { await ctx.fiber.dispose() }
})

it('propagates the host gate failure', async () => {
  vi.mocked(assertDarwinHost).mockImplementationOnce(() => { throw new Error('requires darwin') })
  const { ctx } = await mount(handle({ exitCode: 0, signal: null }, { stdout: CATALOG }))
  try {
    await expect(ctx.plugin(Provider, {})).rejects.toThrow('requires darwin')
  } finally { await ctx.fiber.dispose() }
})

it.each([
  { outcome: { exitCode: 1, signal: null }, stderr: 'say: speech synthesis server failure', expected: 'voice listing failed (exit code 1, signal null): say: speech synthesis server failure' },
  { outcome: { exitCode: null, signal: 'SIGTERM' as const }, expected: 'voice listing failed (exit code null, signal SIGTERM)' },
])('rejects a failing voice listing (%j)', async ({ outcome, stderr, expected }) => {
  const { ctx } = await mount(handle(outcome, stderr === undefined ? {} : { stderr }))
  try {
    await expect(ctx.plugin(Provider, {})).rejects.toThrow(expected)
  } finally { await ctx.fiber.dispose() }
})

it('rejects an empty catalog and a catalog without configured locales', async () => {
  const silent = await mount(handle({ exitCode: 0, signal: null }))
  try {
    await expect(silent.ctx.plugin(Provider, {})).rejects.toThrow('macOS speech voice catalog has no voices for locales: zh, en')
  } finally { await silent.ctx.fiber.dispose() }
  const japanese = await mount(handle({ exitCode: 0, signal: null }, { stdout: CATALOG }))
  try {
    await expect(japanese.ctx.plugin(Provider, { locales: ['ja'] })).rejects.toThrow('no voices for locales: ja')
  } finally { await japanese.ctx.fiber.dispose() }
})

it('rejects invalid configuration', () => {
  expect(() => Provider.Config({ locales: ['english'] })).toThrow()
  expect(() => Provider.Config({ sampleRate: 100 })).toThrow()
  expect(() => Provider.Config({ rateWpm: 0 })).toThrow()
})
