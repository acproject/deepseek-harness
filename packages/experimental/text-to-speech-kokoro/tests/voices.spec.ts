/** Kokoro voice table invariants against the upstream v1_0 speaker order. */
import { describe, expect, it } from 'vitest'
import { kokoroVoice, kokoroVoices } from '../src/voices.ts'

describe('kokoro voices', () => {
  it('advertises all 53 named speakers with contiguous sids', () => {
    expect(kokoroVoices).toHaveLength(53)
    expect(kokoroVoices.map(voice => voice.sid)).toEqual(Array.from({ length: 53 }, (_, sid) => sid))
    expect(new Set(kokoroVoices.map(voice => voice.id))).toHaveLength(53)
  })

  it('assigns Chinese and English languages to the documented sid ranges', () => {
    for (const voice of kokoroVoices.filter(candidate => candidate.sid <= 44)) {
      expect(voice.languages).toContain('en')
      expect(voice.languages).not.toContain('zh')
    }
    const chinese = kokoroVoices.filter(voice => voice.sid >= 45)
    expect(chinese.map(voice => voice.id)).toEqual([
      'zf_xiaobei', 'zf_xiaoni', 'zf_xiaoxiao', 'zf_xiaoyi',
      'zm_yunjian', 'zm_yunxi', 'zm_yunxia', 'zm_yunyang',
    ])
    for (const voice of chinese) expect(voice.languages).toEqual(['auto', 'zh', 'en'])
  })

  it('resolves advertised ids and rejects unknown ones', () => {
    expect(kokoroVoice('zf_xiaobei')).toMatchObject({ sid: 45, gender: 'female' })
    expect(kokoroVoice('zm_yunyang')).toMatchObject({ sid: 52, gender: 'male' })
    expect(kokoroVoice('missing')).toBeUndefined()
  })
})
