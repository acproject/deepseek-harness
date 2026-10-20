/** Deployment configuration for the macOS system speech synthesizer. */
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Local `say` runtime and synthesis settings. */
export interface Config {
  /** Unique registration id; consumers select this exact id. */
  providerId: string
  /** Executable invoked for the voice catalog and synthesis; an absolute path overrides PATH lookup. */
  command: string
  /** Primary locale subtags selecting catalog voices, for example `zh` and `en`. */
  locales: string[]
  /** Speaking rate in words per minute; omission keeps each voice's native rate. */
  rateWpm?: number | undefined
  /** Output sample rate in hertz requested from `say`. */
  sampleRate: number
  /** Maximum request text length measured in Unicode code points. */
  maxTextChars: number
  /** Maximum produced WAV bytes accepted from one synthesis. */
  maxAudioBytes: number
  /** Deadline for reading the voice catalog at activation. */
  voiceListTimeoutMs: number
  /** Deadline for one synthesis request. */
  synthesisTimeoutMs: number
  /** Managed process termination grace period. */
  graceMs: number
  /** Maximum retained `say` diagnostic bytes. */
  maxLogBytes: number
}

/** Validate deployment-varying runtime choices at plugin activation. */
export const Config: z<Partial<Config>, Config> = z.object({
  providerId: z.string().min(1).default('macos-say'),
  command: z.string().min(1).default('say'),
  locales: z.array(z.string().pattern(/^[a-z]{2,3}$/)).min(1).default(['zh', 'en']),
  rateWpm: z.union([z.natural().min(1), z.const(undefined)]),
  sampleRate: z.natural().min(8000).max(96000).default(24000),
  maxTextChars: z.natural().min(1).default(500),
  maxAudioBytes: z.natural().min(46).default(16 * 1024 * 1024),
  voiceListTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(10_000),
  synthesisTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(60_000),
  graceMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(1000),
  maxLogBytes: z.natural().min(1).default(64 * 1024),
})
