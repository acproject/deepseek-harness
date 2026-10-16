/** Deployment configuration for the managed local Kokoro synthesizer. */
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Local runtime, synthesis, and retention settings. */
export interface Config {
  /** Unique registration id; consumers select this exact id. */
  providerId: string
  /** Absolute directory for the verified archive, extracted models and process runtime. */
  dataRoot: string
  /** Existing extracted-model directory; omission downloads and verifies an archive. */
  modelDirectory?: string | undefined
  /** Weight precision; INT8 minimizes first-use download and model storage. */
  precision: 'int8' | 'fp32'
  /** Playback rate passed to Kokoro; 1 is natural speed. */
  speed: number
  /** CPU intra-operation thread count. */
  threads: number
  /** Explicit release origin; bypasses automatic selection and fallback. */
  modelOrigin?: string | undefined
  /** Release origins compared before downloading the model archive. */
  modelOrigins: string[]
  /** Deadline for concurrent HEAD probes, including redirects to the archive. */
  modelProbeTimeoutMs: number
  /** Maximum request text length measured in Unicode code points. */
  maxTextChars: number
  /** Maximum produced WAV bytes accepted from the private worker. */
  maxAudioBytes: number
  /** Deadline for archive download, extraction and cold model loading. */
  prepareTimeoutMs: number
  /** Deadline for one synthesis after the worker is ready. */
  synthesisTimeoutMs: number
  /** Idle period before stopping the worker; zero keeps it warm. */
  idleTimeoutMs: number
  /** Maximum accepted running and waiting syntheses. */
  maxPending: number
  /** Managed process termination grace period. */
  graceMs: number
  /** Maximum retained worker diagnostic bytes. */
  maxLogBytes: number
  /** Maximum audio response bytes, including response headers allowance. */
  maxResponseBytes: number
  /** Minimum interval between intermediate download progress notifications. */
  progressIntervalMs: number
}

/** Validate deployment-varying runtime choices at plugin activation. */
export const Config: z<Partial<Config>, Config> = z.object({
  providerId: z.string().min(1).default('kokoro-local'),
  dataRoot: z.string().min(1).required(),
  modelDirectory: z.union([z.string().min(1), z.const(undefined)]),
  precision: z.union(['int8', 'fp32']).default('int8'),
  speed: z.number().min(0.5).max(2).default(1),
  threads: z.natural().min(1).default(2),
  modelOrigin: z.union([z.string().pattern(/^https?:\/\/[^/\s?#@]+\/?$/), z.const(undefined)]),
  modelOrigins: z.array(z.string().pattern(/^https?:\/\/[^/\s?#@]+\/?$/)).min(1)
    .default(['https://github.com']),
  modelProbeTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(3000),
  maxTextChars: z.natural().min(1).default(500),
  maxAudioBytes: z.natural().min(46).default(16 * 1024 * 1024),
  prepareTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(3_600_000),
  synthesisTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(120_000),
  idleTimeoutMs: z.natural().max(MAX_TIMER_DELAY_MS).default(300_000),
  maxPending: z.natural().min(1).default(4),
  graceMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(1000),
  maxLogBytes: z.natural().min(1).default(64 * 1024),
  maxResponseBytes: z.natural().min(1).default(16 * 1024 * 1024 + 4096),
  progressIntervalMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(100),
})
