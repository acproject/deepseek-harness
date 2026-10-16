/** Kokoro multi-language v1_0 voice identities, fixed by the upstream voices.bin order. */
import type { SynthesisVoice } from '@deepseek-ai/dsh-experimental-text-to-speech/types'

interface KokoroVoice extends SynthesisVoice {
  /** Native speaker index consumed by OfflineTts.generate. */
  readonly sid: number
}

const english: ReadonlyArray<readonly [string, number, 'female' | 'male']> = [
  ['af_alloy', 0, 'female'], ['af_aoede', 1, 'female'], ['af_bella', 2, 'female'], ['af_heart', 3, 'female'],
  ['af_jessica', 4, 'female'], ['af_kore', 5, 'female'], ['af_nicole', 6, 'female'], ['af_nova', 7, 'female'],
  ['af_river', 8, 'female'], ['af_sarah', 9, 'female'], ['af_sky', 10, 'female'],
  ['am_adam', 11, 'male'], ['am_echo', 12, 'male'], ['am_eric', 13, 'male'], ['am_fenrir', 14, 'male'],
  ['am_liam', 15, 'male'], ['am_michael', 16, 'male'], ['am_onyx', 17, 'male'], ['am_puck', 18, 'male'],
  ['am_santa', 19, 'male'],
  ['bf_alice', 20, 'female'], ['bf_emma', 21, 'female'], ['bf_isabella', 22, 'female'], ['bf_lily', 23, 'female'],
  ['bm_daniel', 24, 'male'], ['bm_fable', 25, 'male'], ['bm_george', 26, 'male'], ['bm_lewis', 27, 'male'],
  ['ef_dora', 28, 'female'], ['em_alex', 29, 'male'], ['ff_siwis', 30, 'female'],
  ['hf_alpha', 31, 'female'], ['hf_beta', 32, 'female'], ['hm_omega', 33, 'male'], ['hm_psi', 34, 'male'],
  ['if_sara', 35, 'female'], ['im_nicola', 36, 'male'],
  ['jf_alpha', 37, 'female'], ['jf_gongitsune', 38, 'female'], ['jf_nezumi', 39, 'female'],
  ['jf_tebukuro', 40, 'female'], ['jm_kumo', 41, 'male'],
  ['pf_dora', 42, 'female'], ['pm_alex', 43, 'male'], ['pm_santa', 44, 'male'],
]

// The v1_0 multi-language pipeline accepts English and Chinese; Chinese voices also read embedded English.
const chinese: ReadonlyArray<readonly [string, number, 'female' | 'male']> = [
  ['zf_xiaobei', 45, 'female'], ['zf_xiaoni', 46, 'female'], ['zf_xiaoxiao', 47, 'female'], ['zf_xiaoyi', 48, 'female'],
  ['zm_yunjian', 49, 'male'], ['zm_yunxi', 50, 'male'], ['zm_yunxia', 51, 'male'], ['zm_yunyang', 52, 'male'],
]

function toVoices(entries: ReadonlyArray<readonly [string, number, 'female' | 'male']>, languages: readonly string[]): readonly KokoroVoice[] {
  return entries.map(([id, sid, gender]) => ({ id, name: id, sid, languages, gender }))
}

/** All registered voices in sid order; ids 0-44 are English voices, ids 45-52 are Chinese voices. */
export const kokoroVoices: readonly KokoroVoice[] = [
  ...toVoices(english, ['auto', 'en']),
  ...toVoices(chinese, ['auto', 'zh', 'en']),
]

const byId = new Map(kokoroVoices.map(voice => [voice.id, voice]))

/**
 * Resolve one advertised voice id to its native speaker index.
 * @param voiceId - exact SynthesisVoice id from provider info.
 * @returns the matching voice, or undefined for unknown input.
 */
export function kokoroVoice(voiceId: string): KokoroVoice | undefined {
  return byId.get(voiceId)
}
