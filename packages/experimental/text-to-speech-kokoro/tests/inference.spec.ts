/** Canonical PCM16 WAV encoding shared with the client playback contract. */
import { expect, it } from 'vitest'
import { encodeWav } from '../src/inference.ts'
import { SynthesisInputError } from '../src/input.ts'
import { validateText } from '../src/input.ts'

it('writes a mono 24 kHz PCM16 WAV header and clamped samples', () => {
  const wav = encodeWav(Float32Array.from([0, 0.5, -1, 2]), 24000)
  expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
  expect(wav.readUInt32LE(4)).toBe(wav.length - 8)
  expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
  expect(wav.readUInt16LE(20)).toBe(1)
  expect(wav.readUInt16LE(22)).toBe(1)
  expect(wav.readUInt32LE(24)).toBe(24000)
  expect(wav.readUInt32LE(28)).toBe(48000)
  expect(wav.readUInt16LE(32)).toBe(2)
  expect(wav.readUInt16LE(34)).toBe(16)
  expect(wav.toString('ascii', 36, 40)).toBe('data')
  expect(wav.readUInt32LE(40)).toBe(8)
  expect(wav.length).toBe(52)
  expect(wav.readInt16LE(44)).toBe(0)
  expect(wav.readInt16LE(46)).toBe(Math.trunc(0.5 * 0x7fff))
  expect(wav.readInt16LE(48)).toBe(-0x8000)
  expect(wav.readInt16LE(50)).toBe(0x7fff)
})

it('rejects empty and over-long text in code points', () => {
  expect(() => { validateText('  \n ', 10) }).toThrow(SynthesisInputError)
  expect(() => { validateText('你好', 1) }).toThrow(SynthesisInputError)
  validateText('你', 1)
})
