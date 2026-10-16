import { describe, expect, it } from 'vitest'
import {
  computeRms,
  concatFrames,
  DEFAULT_VAD_PARAMS,
  LinearResampler,
  PreRollRing,
  VadGate,
  type VadParams,
} from '../src/client/vad.ts'

const FRAME_MS = 50

function frames(gate: VadGate, count: number, rms: number, playbackActive = false) {
  return Array.from({ length: count }, () => gate.update({ rms, frameMs: FRAME_MS, playbackActive }))
}

function calibrate(gate: VadGate) {
  return frames(gate, 10, 0.001)
}

describe('VadGate', () => {
  it('calibrates on a quiet prefix and reports the noise floor', () => {
    const gate = new VadGate()
    const events = calibrate(gate)
    expect(events).toContainEqual({ type: 'silence' })
    expect(gate.noiseFloor).toBeCloseTo(0.001, 6)
    expect(gate.currentState).toBe('silence')
  })

  it('restarts calibration when the room is loud, then falls back at the cap', () => {
    const gate = new VadGate({ ...DEFAULT_VAD_PARAMS, calibrationMs: 200, calibrationCapMs: 400 })
    const events = frames(gate, 8, 0.05)
    expect(events.slice(0, 3)).not.toContainEqual({ type: 'silence' })
    expect(events.at(-1)).toEqual({ type: 'silence' })
    expect(gate.noiseFloor).toBe(DEFAULT_VAD_PARAMS.minStartRms)
  })

  it('opens on speech and closes on trailing silence with voiced timing', () => {
    const gate = new VadGate()
    calibrate(gate)
    expect(gate.update({ rms: 0.1, frameMs: FRAME_MS, playbackActive: false })).toEqual({ type: 'start' })
    frames(gate, 2, 0.1)
    const end = frames(gate, 14, 0.001).find(event => event.type === 'end')
    expect(end).toEqual({ type: 'end', reason: 'silence', voicedMs: 150, trailingSilenceMs: 700 })
  })

  it('caps overly long utterances', () => {
    const gate = new VadGate()
    calibrate(gate)
    gate.update({ rms: 0.1, frameMs: FRAME_MS, playbackActive: false })
    const events = frames(gate, 400, 0.1)
    expect(events).toContainEqual({ type: 'end', reason: 'max-duration', voicedMs: 20000, trailingSilenceMs: 0 })
  })

  it('requires sustained loud frames to confirm barge-in over playback', () => {
    const gate = new VadGate()
    calibrate(gate)
    expect(gate.update({ rms: 0.05, frameMs: FRAME_MS, playbackActive: true })).toEqual({ type: 'barge-pending' })
    expect(gate.update({ rms: 0.005, frameMs: FRAME_MS, playbackActive: true })).toEqual({ type: 'silence' })

    expect(gate.update({ rms: 0.05, frameMs: FRAME_MS, playbackActive: true })).toEqual({ type: 'barge-pending' })
    const confirm = frames(gate, 5, 0.05, true)
    expect(confirm).toContainEqual({ type: 'start' })
  })

  it('ignores ordinary-onset energy below the barge floor during playback', () => {
    const params: VadParams = { ...DEFAULT_VAD_PARAMS, minBargeRms: 0.1 }
    const gate = new VadGate(params)
    calibrate(gate)
    frames(gate, 20, 0.05, true)
    expect(gate.currentState).toBe('silence')
  })

  it('reset restarts calibration', () => {
    const gate = new VadGate()
    calibrate(gate)
    gate.reset()
    expect(gate.currentState).toBe('calibrating')
    expect(gate.noiseFloor).toBe(0)
  })
})

describe('LinearResampler', () => {
  it('returns the input untouched at matching rates', () => {
    const resampler = new LinearResampler(16000, 16000)
    const chunk = new Float32Array([1, 2, 3])
    expect(resampler.push(chunk)).toBe(chunk)
  })

  it('downsamples 48 kHz to 16 kHz with phase continuity across chunks', () => {
    const resampler = new LinearResampler(48000, 16000)
    const first = Float32Array.from({ length: 300 }, (_, index) => index)
    const out1 = resampler.push(first)
    expect(out1).toHaveLength(100)
    expect(out1[0]).toBe(0)
    const second = Float32Array.from({ length: 300 }, (_, index) => 1000 + index)
    const out2 = resampler.push(second)
    expect(out2).toHaveLength(100)
    expect(out2[0]).toBe(1000)
  })

  it('handles non-integer ratios', () => {
    const resampler = new LinearResampler(44100, 16000)
    expect(resampler.push(new Float32Array(441))).toHaveLength(160)
  })

  it('rejects non-positive rates', () => {
    expect(() => new LinearResampler(0, 16000)).toThrow(RangeError)
  })
})

describe('PreRollRing', () => {
  it('keeps only the most recent samples', () => {
    const ring = new PreRollRing(5)
    ring.push(Float32Array.from([1, 2, 3, 4, 5, 6, 7]))
    ring.push(Float32Array.from([8]))
    expect(Array.from(ring.snapshot())).toEqual([4, 5, 6, 7, 8])
  })

  it('clears and reports length', () => {
    const ring = new PreRollRing(5)
    ring.push(Float32Array.from([1, 2]))
    expect(ring.length).toBe(2)
    ring.clear()
    expect(ring.length).toBe(0)
  })
})

describe('computeRms / concatFrames', () => {
  it('computes root mean square', () => {
    expect(computeRms(Float32Array.from([3, 4]))).toBeCloseTo(Math.sqrt(12.5), 10)
    expect(computeRms(new Float32Array(0))).toBe(0)
  })

  it('concatenates frames in order', () => {
    expect(Array.from(concatFrames([Float32Array.from([1, 2]), Float32Array.from([3])]))).toEqual([1, 2, 3])
  })
})
