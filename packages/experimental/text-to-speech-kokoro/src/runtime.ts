/** Verified release archive and managed extraction for local Kokoro synthesis. */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { Config } from './config.ts'
import type { SynthesisPreparationState } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import { timeoutOf } from '@deepseek-ai/dsh-timeout'
import { classifyDownloadFailure, SynthesisDownloadError } from './download-error.ts'
import { orderModelSources } from './model-sources.ts'

/** Release-pinned downloadable file. */
export interface Asset {
  readonly name: string
  readonly url: string
  readonly sha256: string
  readonly bytes: number
}

interface RuntimeLock {
  archives: Record<Config['precision'], Asset>
  files: {
    modelInt8: Asset
    modelFp32: Asset
    voices: Asset
    tokens: Asset
    lexiconEn: Asset
    lexiconZh: Asset
  }
}

/** Prepared model and process paths, private to the local provider. */
export interface RuntimePaths {
  readonly model: string
  readonly voices: string
  readonly tokens: string
  readonly dataDir: string
  readonly lexiconEn: string
  readonly lexiconZh: string
  readonly worker: string
}

/** Resolved archive, extraction layout and process paths. */
export interface ResolvedRuntime {
  readonly lock: RuntimeLock
  readonly archive: Asset
  readonly modelRoot: string
  readonly modelsRoot: string
  readonly archivePath: string
  readonly stampPath: string
  readonly paths: RuntimePaths
  readonly manual: boolean
}

const stampName = '.dsh-verified'
const phonemeData = ['phontab', 'phonindex', 'phondata']

/* jscpd:ignore-start -- pinned-file verification is the same hash contract as speech recognition assets */
async function matchesAsset(path: string, asset: Asset, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted()
  try {
    const info = await stat(path)
    if (!info.isFile()) throw new Error(`Speech asset is not a regular file: ${path}`)
    if (info.size !== asset.bytes) return false
    const digest = createHash('sha256')
    for await (const chunk of createReadStream(path, { signal })) digest.update(chunk as Buffer)
    return digest.digest('hex') === asset.sha256
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
}
/* jscpd:ignore-end */

/**
 * Resolve the verified archive entry and on-disk model and worker paths for the configured precision.
 * @param config - validated provider configuration.
 * @returns release lock selection and absolute runtime paths.
 * @throws when the current platform/architecture has no published runtime.
 */
export function resolveRuntime(config: Config): ResolvedRuntime {
  const supported = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64']
  if (!supported.includes(`${process.platform}-${process.arch}`)) throw new Error(`Local speech synthesis is unavailable for ${process.platform}-${process.arch}`)
  const lock = JSON.parse(readFileSync(new URL('../runtime/assets.json', import.meta.url), 'utf8')) as RuntimeLock
  const archive = lock.archives[config.precision]
  const stem = archive.name.replace(/\.tar\.bz2$/, '')
  const modelRoot = config.modelDirectory ?? join(config.dataRoot, 'models', stem)
  const modelAsset = config.precision === 'int8' ? lock.files.modelInt8 : lock.files.modelFp32
  const paths: RuntimePaths = {
    model: join(modelRoot, modelAsset.name),
    voices: join(modelRoot, lock.files.voices.name),
    tokens: join(modelRoot, lock.files.tokens.name),
    dataDir: join(modelRoot, 'espeak-ng-data'),
    lexiconEn: join(modelRoot, lock.files.lexiconEn.name),
    lexiconZh: join(modelRoot, lock.files.lexiconZh.name),
    /* v8 ignore next -- built worker resolution is exercised by real Node and Electron process smokes */
    worker: fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url)),
  }
  return {
    lock, archive, modelRoot, modelsRoot: join(config.dataRoot, 'models'), manual: config.modelDirectory !== undefined,
    archivePath: join(config.dataRoot, 'downloads', archive.name),
    stampPath: join(modelRoot, stampName), paths,
  }
}

/* jscpd:ignore-start -- local path probes share token-level presence/stamp structure with the archive verifier */
/** Managed model files whose size and hash are pinned; espeak data integrity is covered by the archive stamp. */
function pinnedFiles(resolved: ResolvedRuntime): ReadonlyArray<readonly [string, Asset]> {
  const { lock, paths } = resolved
  return [
    [paths.model, resolved.archive.name.includes('int8') ? lock.files.modelInt8 : lock.files.modelFp32],
    [paths.voices, lock.files.voices], [paths.tokens, lock.files.tokens],
    [paths.lexiconEn, lock.files.lexiconEn], [paths.lexiconZh, lock.files.lexiconZh],
  ]
}

async function filesPresent(resolved: ResolvedRuntime, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted()
  const paths = [resolved.paths.model, resolved.paths.voices, resolved.paths.tokens,
    resolved.paths.lexiconEn, resolved.paths.lexiconZh]
  try {
    await Promise.all(paths.map(path => access(path)))
    const data = await stat(resolved.paths.dataDir)
    if (!data.isDirectory()) return false
    await Promise.all(phonemeData.map(name => access(join(resolved.paths.dataDir, name))))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
  return true
}

async function stampValid(resolved: ResolvedRuntime): Promise<boolean> {
  try {
    const stamp = await readFile(resolved.stampPath, 'utf8')
    return stamp.trim() === resolved.archive.sha256
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
}

async function writeStamp(resolved: ResolvedRuntime): Promise<void> {
  await mkdir(resolved.modelRoot, { recursive: true })
  await writeFile(resolved.stampPath, `${resolved.archive.sha256}\n`, { mode: 0o600 })
}
/* jscpd:ignore-end */

async function verifyRuntime(resolved: ResolvedRuntime, signal: AbortSignal): Promise<boolean> {
  if (!await filesPresent(resolved, signal)) return false
  signal.throwIfAborted()
  if (resolved.manual) return true
  if (!await stampValid(resolved)) return false
  for (const [path, asset] of pinnedFiles(resolved)) if (!await matchesAsset(path, asset, signal)) return false
  signal.throwIfAborted()
  return true
}

/**
 * Inspect an existing extraction without downloading, writing files or starting the worker.
 * @param config - model paths and selected precision.
 * @param signal - provider cancellation or inspection deadline.
 * @returns cached paths when the stamp and pinned files verify; otherwise undefined.
 */
export async function inspectRuntime(config: Config, signal: AbortSignal): Promise<RuntimePaths | undefined> {
  const resolved = resolveRuntime(config)
  return await verifyRuntime(resolved, signal) ? resolved.paths : undefined
}

/**
 * Download into a unique partial file, verify, then publish it atomically.
 * @param asset - pinned release archive identity.
 * @param destination - final archive path in the provider cache.
 * @param signal - preparation cancellation.
 * @param report - Host-owned progress publisher.
 * @returns the verified local archive path; failures carry localized-UI diagnostics through SynthesisDownloadError.
 */
export async function downloadArchive(asset: Asset, destination: string, signal: AbortSignal,
  report: (state: SynthesisPreparationState) => void = () => {}): Promise<string> {
  /* jscpd:ignore-start -- streaming size/hash verification and failure classification follow the shared downloader protocol */
  signal.throwIfAborted()
  const root = dirname(destination)
  const partial = `${destination}.${randomUUID()}.part`
  let source = new URL(asset.url).origin
  try {
    await mkdir(root, { recursive: true })
    if (await matchesAsset(destination, asset, signal)) return destination
    try {
      const response = await fetch(asset.url, { signal })
      source = new URL(response.url || asset.url).origin
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        throw new SynthesisDownloadError({ resource: asset.name, source, reason: 'http', status: response.status })
      }
      const digest = createHash('sha256')
      let completedBytes = 0
      const publish = (): void => { report({ phase: 'downloading', resource: asset.name, completedBytes, totalBytes: asset.bytes, step: 'model' }) }
      publish()
      const hashing = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        completedBytes += chunk.length
        if (completedBytes > asset.bytes) {
          callback(new SynthesisDownloadError({ resource: asset.name, source, reason: 'integrity' })); return
        }
        digest.update(chunk); publish(); callback(null, chunk)
      } })
      await pipeline(response.body, hashing, createWriteStream(partial, { flags: 'wx', mode: 0o600 }), { signal })
      if (completedBytes !== asset.bytes || digest.digest('hex') !== asset.sha256) {
        throw new SynthesisDownloadError({ resource: asset.name, source, reason: 'integrity' })
      }
      signal.throwIfAborted()
      await rename(partial, destination)
      return destination
    } finally {
      await rm(partial, { force: true })
    }
  } catch (error) {
    const timedOut = timeoutOf(signal)
    if (signal.aborted && !timedOut || error instanceof SynthesisDownloadError) throw error
    throw new SynthesisDownloadError({ resource: asset.name, source,
      ...timedOut ? { reason: 'timeout' } : classifyDownloadFailure(error),
    }, { cause: error })
  }
  /* jscpd:ignore-end */
}

/**
 * Extract a verified bzip2 tar archive with the platform tar into the managed models directory.
 * @param ctx - Host subprocess owner.
 * @param resolved - archive source and extraction target.
 * @param signal - preparation cancellation or deadline.
 */
export async function extractArchive(ctx: Context, resolved: ResolvedRuntime, signal: AbortSignal): Promise<void> {
  await rm(resolved.modelRoot, { recursive: true, force: true })
  await mkdir(resolved.modelsRoot, { recursive: true })
  const command = process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : '/usr/bin/tar'
  const handle = ctx.subprocess.spawn({
    argv: [command, '-xjf', resolved.archivePath, '-C', resolved.modelsRoot],
    cwd: resolved.modelsRoot, graceMs: 1000,
    env: {}, stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 64 * 1024 } },
  })
  const outcome = await handle.done
  signal.throwIfAborted()
  if (outcome.exitCode !== 0) {
    throw new Error(`Kokoro archive extraction failed${outcome.signal ? ` (${outcome.signal})` : ''}: ${handle.collected.stderr?.readFrom(0).text ?? ''}`)
  }
}

/**
 * Resolve the bundled native runtime and prepare the verified Kokoro archive on demand.
 * @param ctx - Host context owning the preparation task and extraction subprocess.
 * @param config - model paths, precision, and download source policy.
 * @param signal - preparation cancellation or deadline.
 * @param report - Host-owned progress publisher.
 * @returns verified model and worker paths.
 */
export async function prepareRuntime(ctx: Context, config: Config, signal: AbortSignal,
  report: (state: SynthesisPreparationState) => void = () => {}): Promise<RuntimePaths> {
  const resolved = resolveRuntime(config)
  report({ phase: 'checking', step: 'check', startedAt: Date.now() })
  if (await verifyRuntime(resolved, signal)) return resolved.paths
  if (!resolved.manual && await filesPresent(resolved, signal)) {
    const pinned = await Promise.all(pinnedFiles(resolved).map(async ([path, asset]) => await matchesAsset(path, asset, signal)))
    if (pinned.every(Boolean)) {
      await writeStamp(resolved)
      if (await verifyRuntime(resolved, signal)) return resolved.paths
    }
  }
  if (resolved.manual) throw new Error('Kokoro model verification failed: missing files in the configured model directory')
  const origins = config.modelOrigin === undefined ? config.modelOrigins : [config.modelOrigin]
  const urls = await orderModelSources(resolved.archive.url, origins, config.modelProbeTimeoutMs, signal)
  let downloaded: string | undefined
  for (const [index, url] of urls.entries()) {
    try {
      downloaded = await downloadArchive({ ...resolved.archive, url }, resolved.archivePath, signal, report)
      break
    } catch (error) {
      if (signal.aborted || !(error instanceof SynthesisDownloadError) || error.download.reason === 'storage'
        || error.download.reason === 'unknown' || index === urls.length - 1) throw error
    }
  }
  if (downloaded === undefined) throw new Error('Kokoro archive download produced no file')
  report({ phase: 'checking', step: 'model', startedAt: Date.now() })
  await extractArchive(ctx, resolved, signal)
  report({ phase: 'checking', step: 'verify', startedAt: Date.now() })
  await writeStamp(resolved)
  if (!await verifyRuntime(resolved, signal)) throw new Error('Kokoro model verification failed: missing or corrupted archive files')
  return resolved.paths
}
