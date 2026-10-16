/** Archive verification, stamp recovery and system-tar extraction of the managed Kokoro runtime. */
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { accessSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, expect, it } from 'vitest'
import { Config } from '../src/config.ts'
import { extractArchive, inspectRuntime, prepareRuntime, resolveRuntime } from '../src/runtime.ts'

const roots: string[] = []
function makeRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-kokoro-runtime-')))
  roots.push(root)
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function resolvedConfig(root: string, precision: 'int8' | 'fp32' = 'int8'): ReturnType<typeof Config> {
  return Config({ dataRoot: root, precision, modelOrigins: ['https://github.com'] })
}

function writeModelDirectory(root: string): string {
  for (const name of ['model.int8.onnx', 'voices.bin', 'tokens.txt', 'lexicon-us-en.txt', 'lexicon-zh.txt']) {
    writeFileSync(join(root, name), `content-${name}`)
  }
  mkdirSync(join(root, 'espeak-ng-data'), { recursive: true })
  for (const name of ['phontab', 'phonindex', 'phondata']) writeFileSync(join(root, 'espeak-ng-data', name), name)
  return root
}

it('accepts a complete manual model directory without a stamp', async () => {
  const root = makeRoot(), manual = join(root, 'manual')
  mkdirSync(manual, { recursive: true })
  writeModelDirectory(manual)
  const paths = await inspectRuntime(Config({ dataRoot: root, modelDirectory: manual }), new AbortController().signal)
  expect(paths?.model).toBe(join(manual, 'model.int8.onnx'))
  expect(paths?.dataDir).toBe(join(manual, 'espeak-ng-data'))
})

it('returns no cached runtime for an empty cache or a tampered managed extraction', async () => {
  const root = makeRoot(), signal = new AbortController().signal
  expect(await inspectRuntime(resolvedConfig(root), signal)).toBeUndefined()
  const resolved = resolveRuntime(resolvedConfig(root))
  mkdirSync(resolved.modelRoot, { recursive: true })
  writeModelDirectory(resolved.modelRoot)
  expect(await inspectRuntime(resolvedConfig(root), signal)).toBeUndefined()
  writeFileSync(resolved.stampPath, 'wrong-stamp\n')
  expect(await inspectRuntime(resolvedConfig(root), signal)).toBeUndefined()
})

it.runIf(process.platform !== 'win32')('extracts a release archive into the managed model directory with system tar', async () => {
  let available = true
  try { accessSync('/usr/bin/tar') } catch { available = false }
  if (!available) return
  const root = makeRoot(), ctx = new Context()
  await ctx.plugin(LocalSubprocess)
  try {
    const resolved = resolveRuntime(resolvedConfig(root))
    const source = join(root, 'source'), stem = 'kokoro-int8-multi-lang-v1_0'
    mkdirSync(join(source, stem, 'espeak-ng-data'), { recursive: true })
    writeFileSync(join(source, stem, 'tokens.txt'), 'tokens')
    writeFileSync(join(source, stem, 'espeak-ng-data', 'phondata'), 'ph')
    mkdirSync(dirname(resolved.archivePath), { recursive: true })
    execFileSync('/usr/bin/tar', ['-cjf', resolved.archivePath, '-C', source, stem])
    await extractArchive(ctx, resolved, new AbortController().signal)
    accessSync(join(resolved.modelRoot, 'tokens.txt'))
    accessSync(join(resolved.modelRoot, 'espeak-ng-data', 'phondata'))
  } finally { await ctx.fiber.dispose() }
})

it('surfaces archive integrity failures after a wrong-length download', async () => {
  const root = makeRoot()
  const server = createServer((_request, response) => { response.end('short') })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  try {
    const port = (server.address() as { port: number }).port
    const config = Config({ dataRoot: root, modelOrigins: [`http://127.0.0.1:${port}`] })
    await expect(prepareRuntime(new Context(), config, new AbortController().signal))
      .rejects.toMatchObject({ download: { reason: 'integrity' } })
  } finally { await new Promise<void>((resolve) => { server.close(() => { resolve() }) }) }
})
