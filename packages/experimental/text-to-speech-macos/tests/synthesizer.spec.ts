/** `say` request execution: argv and stdin delivery, WAV validation, failures, cleanup, and the host gate. */
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, expect, it, vi } from 'vitest'
import { Config } from '../src/config.ts'
import { SynthesisInputError } from '../src/input.ts'
import { assertDarwinHost } from '../src/platform.ts'
import { SaySynthesizer, validateWav } from '../src/synthesizer.ts'
import type { MacosVoice } from '../src/voices.ts'
import { outputPath, wav } from './fixtures.ts'

afterEach(() => { vi.restoreAllMocks() })

const EXIT_ZERO: SubprocessOutcome = { exitCode: 0, signal: null }
const VOICE = 'Tingting (中文（中国大陆）)'
const INPUT = { text: '你好，系统语音。', voiceId: VOICE, language: 'auto' } as const

const voices: readonly MacosVoice[] = [{ id: VOICE, name: '婷婷', locale: 'zh_CN', languages: ['auto', 'zh', 'en'] }]

interface Behavior {
  readonly outcome?: SubprocessOutcome | undefined
  readonly stderr?: string | undefined
  readonly write?: Buffer | undefined
}

/** Build one synthesizer over a mocked subprocess service that records every spawn. */
async function mount(behavior: Behavior, options: Record<string, unknown> = {}) {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocess)
  const specs: SubprocessSpawnSpec[] = []
  vi.spyOn(ctx.get('subprocess')!, 'spawn').mockImplementation((spec) => {
    specs.push(spec)
    const pending = Promise.withResolvers<SubprocessOutcome>()
    const settle = (outcome: SubprocessOutcome): void => { pending.resolve(outcome) }
    if (behavior.outcome !== undefined) settle(behavior.outcome)
    else spec.signal?.addEventListener('abort', () => { settle({ exitCode: null, signal: 'SIGTERM' }) }, { once: true })
    if (behavior.write !== undefined) writeFileSync(outputPath(spec), behavior.write)
    const handle: SubprocessHandle = {
      stdin: undefined, stdout: undefined, stderr: undefined, control: undefined,
      collected: behavior.stderr === undefined ? {}
        : { stderr: { readFrom: () => ({ text: behavior.stderr!, nextOffset: behavior.stderr!.length, lossy: false }) } },
      done: pending.promise,
      terminate: () => { if (behavior.outcome === undefined) settle({ exitCode: null, signal: 'SIGTERM' }) },
      waitForExit: () => Promise.resolve(true),
    }
    return handle
  })
  return { synthesizer: new SaySynthesizer(ctx, Config(options), voices), specs, ctx }
}

/** Every spawn captures a fresh temporary file; each settled request must have removed it. */
async function expectCleanedUp(spec: SubprocessSpawnSpec): Promise<void> {
  await Promise.resolve()
  expect(existsSync(outputPath(spec))).toBe(false)
}

it('speaks through one say process with bounded argv and stdin text', async () => {
  const { synthesizer, specs, ctx } = await mount({ outcome: EXIT_ZERO, write: wav() }, { rateWpm: 180 })
  try {
    const result = await synthesizer.synthesize(INPUT, new AbortController().signal)
    expect(specs).toHaveLength(1)
    const spec = specs[0]!
    expect(spec.argv).toEqual(['say', '-v', VOICE, '--file-format=WAVE', '--data-format=LEI16@24000', '--channels=1',
      '-r', '180', '-o', outputPath(spec), '-f', '-'])
    expect(spec.stdio.stdin).toEqual({ data: INPUT.text })
    expect(spec.cwd).toBe(tmpdir())
    expect(result).toMatchObject({ mimeType: 'audio/wav', sampleRate: 24000, audioSeconds: 0.1 })
    expect(result.audio.byteLength).toBe(wav().byteLength)
    expect(result.synthesisSeconds).toBeGreaterThanOrEqual(0)
    await expectCleanedUp(spec)
  } finally { await ctx.fiber.dispose() }
})

it('omits the speaking rate when unset', async () => {
  const { synthesizer, specs, ctx } = await mount({ outcome: EXIT_ZERO, write: wav() })
  try {
    await synthesizer.synthesize(INPUT, new AbortController().signal)
    expect(specs[0]!.argv.includes('-r')).toBe(false)
    await expectCleanedUp(specs[0]!)
  } finally { await ctx.fiber.dispose() }
})

it('rejects empty, over-long text and unknown voices before spawning', async () => {
  const { synthesizer, specs, ctx } = await mount({ outcome: EXIT_ZERO, write: wav() })
  try {
    await expect(synthesizer.synthesize({ ...INPUT, text: '  ' }, new AbortController().signal)).rejects.toThrow(SynthesisInputError)
    await expect(synthesizer.synthesize({ ...INPUT, text: '好'.repeat(501) }, new AbortController().signal))
      .rejects.toThrow('Synthesis text exceeds the code-point limit')
    await expect(synthesizer.synthesize({ ...INPUT, voiceId: 'nope' }, new AbortController().signal))
      .rejects.toThrow('Unknown macOS voice: nope')
    expect(specs).toHaveLength(0)
  } finally { await ctx.fiber.dispose() }
})

it('rejects a cancelled request before spawning', async () => {
  const { synthesizer, specs, ctx } = await mount({ outcome: EXIT_ZERO, write: wav() })
  try {
    const abort = new AbortController()
    abort.abort(new Error('cancelled before start'))
    await expect(synthesizer.synthesize(INPUT, abort.signal)).rejects.toThrow('cancelled before start')
    expect(specs).toHaveLength(0)
  } finally { await ctx.fiber.dispose() }
})

it('terminates the process and rejects with the caller reason on mid-flight cancellation', async () => {
  const { synthesizer, specs, ctx } = await mount({})
  try {
    const abort = new AbortController()
    const pending = synthesizer.synthesize(INPUT, abort.signal)
    abort.abort(new Error('cancelled mid-flight'))
    await expect(pending).rejects.toThrow('cancelled mid-flight')
    await expectCleanedUp(specs[0]!)
  } finally { await ctx.fiber.dispose() }
})

it('times out one hanging synthesis', async () => {
  const { synthesizer, specs, ctx } = await mount({}, { synthesisTimeoutMs: 20 })
  try {
    await expect(synthesizer.synthesize(INPUT, new AbortController().signal)).rejects.toThrow('TTS_MACOS_SYNTHESIS_TIMEOUT after 20ms')
    await expectCleanedUp(specs[0]!)
  } finally { await ctx.fiber.dispose() }
})

it('reports non-zero exits with and without captured diagnostics', async () => {
  const failing = await mount({ outcome: { exitCode: 1, signal: null }, stderr: 'say: voice not found' })
  try {
    await expect(failing.synthesizer.synthesize(INPUT, new AbortController().signal))
      .rejects.toThrow('macOS speech synthesis failed (exit code 1, signal null): say: voice not found')
    await expectCleanedUp(failing.specs[0]!)
  } finally { await failing.ctx.fiber.dispose() }
  const signalled = await mount({ outcome: { exitCode: null, signal: 'SIGKILL' } })
  try {
    await expect(signalled.synthesizer.synthesize(INPUT, new AbortController().signal))
      .rejects.toThrow('macOS speech synthesis failed (exit code null, signal SIGKILL)')
    await expectCleanedUp(signalled.specs[0]!)
  } finally { await signalled.ctx.fiber.dispose() }
})

it('rejects a missing output file and oversized audio', async () => {
  const silent = await mount({ outcome: EXIT_ZERO })
  try {
    await expect(silent.synthesizer.synthesize(INPUT, new AbortController().signal)).rejects.toThrow('wrote no audio output')
    await expectCleanedUp(silent.specs[0]!)
  } finally { await silent.ctx.fiber.dispose() }
  const loud = await mount({ outcome: EXIT_ZERO, write: wav() }, { maxAudioBytes: 100 })
  try {
    await expect(loud.synthesizer.synthesize(INPUT, new AbortController().signal)).rejects.toThrow('byte limit')
    await expectCleanedUp(loud.specs[0]!)
  } finally { await loud.ctx.fiber.dispose() }
})

it('validates RIFF structure, measures duration, and rejects malformed audio', () => {
  expect(validateWav(new Uint8Array(wav()), 24000)).toBe(0.1)
  expect(validateWav(new Uint8Array(wav({ bytes: 4801 })), 24000)).toBe(4801 / 48000)
  expect(validateWav(new Uint8Array(wav({ filler: true })), 24000)).toBe(0.1)
  for (const damaged of [
    wav({ channels: 2 }), wav({ bits: 8 }), wav({ rate: 22050 }), wav({ format: 3 }), wav({ smallFmt: true }),
    wav({ truncate: 4 }), wav({ noFmt: true }), wav({ noData: true }), Buffer.from('not a wav file'),
  ]) {
    expect(() => validateWav(new Uint8Array(damaged), 24000)).toThrow('macOS speech produced')
  }
  expect(() => validateWav(new Uint8Array(wav({ channels: 2 })), 24000)).toThrow('not mono PCM16 at 24000 hertz')
})

it('gates activation on darwin hosts', () => {
  expect(() => { assertDarwinHost('darwin') }).not.toThrow()
  expect(() => { assertDarwinHost('linux') }).toThrow('macOS system speech requires the darwin platform, found linux')
  if (process.platform === 'darwin') expect(() => { assertDarwinHost() }).not.toThrow()
  else expect(() => { assertDarwinHost() }).toThrow('darwin')
})
