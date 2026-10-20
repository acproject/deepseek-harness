/** Shared `say` subprocess test fixtures: WAV assembly and argv inspection. */
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

/** Assemble one RIFF/WAVE file from chunks, with knobs for every malformed variant. */
export function wav(options: {
  bytes?: number
  rate?: number
  channels?: number
  bits?: number
  format?: number
  filler?: boolean
  smallFmt?: boolean
  noFmt?: boolean
  noData?: boolean
  truncate?: number
} = {}): Buffer {
  const { bytes = 4800, rate = 24000, channels = 1, bits = 16, format = 1, filler = false,
    smallFmt = false, noFmt = false, noData = false, truncate = 0 } = options
  const chunk = (id: string, body: Buffer): Buffer => {
    const header = Buffer.alloc(8)
    header.write(id, 0, 'ascii')
    header.writeUInt32LE(body.length, 4)
    return Buffer.concat([header, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)])
  }
  const fmt = Buffer.alloc(16)
  fmt.writeUInt16LE(format, 0)
  fmt.writeUInt16LE(channels, 2)
  fmt.writeUInt32LE(rate, 4)
  fmt.writeUInt32LE(rate * channels * bits / 8, 8)
  fmt.writeUInt16LE(channels * bits / 8, 12)
  fmt.writeUInt16LE(bits, 14)
  const body = Buffer.concat([
    ...noFmt ? [] : [chunk('fmt ', smallFmt ? fmt.subarray(0, 14) : fmt)],
    // The filler chunk carries an odd body size, so it also exercises pad-byte skipping.
    ...filler ? [chunk('FLLR', Buffer.from([1, 2, 3]))] : [],
    ...noData ? [] : [chunk('data', Buffer.alloc(bytes))],
  ])
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(body.length + 4, 4)
  header.write('WAVE', 8, 'ascii')
  const file = Buffer.concat([header, body])
  return truncate > 0 ? file.subarray(0, file.length - truncate) : file
}

/** The `-o` output path of one captured spawn request. */
export function outputPath(spec: SubprocessSpawnSpec): string {
  const index = spec.argv.indexOf('-o')
  if (index < 0 || index + 1 >= spec.argv.length) throw new Error('missing -o argument')
  return spec.argv[index + 1]!
}
