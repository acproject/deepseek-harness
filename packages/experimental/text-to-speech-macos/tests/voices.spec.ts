/** macOS `say` catalog parsing, deduplication, locale filtering and language mapping. */
import { expect, it } from 'vitest'
import { parseVoiceList, selectVoices } from '../src/voices.ts'

const catalog = [
  'Alex    en_US    # Most people recognize me by my voice.',
  'Bad News    en_US    # The light you see at the end of the tunnel is me.',
  'Tingting (中文（中国大陆）)    zh_CN    # 你好！我叫婷婷。',
  'Meijia    zh_TW    # 您好，我叫美佳。',
  'Sinji    zh_HK    # 您好，我叫善怡。',
  'Thomas    de_DE    # Hallo, ich bin Thomas.',
  'No Comment    fr_FR',
  'Empty Comment    it_IT    #',
  'Tingting (中文（中国大陆）)    zh_CN    # 你好！我叫婷婷。我是重复条目。',
  'garbage line without locale',
  '',
].join('\n')

it('parses names with spaces, parentheses and non-Latin text, using the CLI name as the id', () => {
  const voices = parseVoiceList(catalog)
  expect(voices.map(voice => voice.id)).toEqual([
    'Alex', 'Bad News', 'Tingting (中文（中国大陆）)', 'Meijia', 'Sinji', 'Thomas', 'No Comment', 'Empty Comment',
  ])
  expect(voices[0]).toMatchObject({ name: 'Most people recognize me by my voice', locale: 'en_US' })
  expect(voices[1]).toMatchObject({ name: 'The light you see at the end of the tunnel is me', locale: 'en_US' })
  expect(voices[2]).toMatchObject({ name: '你好！我叫婷婷', locale: 'zh_CN' })
})

it('falls back to the CLI name when the comment is missing or empty', () => {
  const voices = parseVoiceList(catalog)
  expect(voices[6]).toMatchObject({ id: 'No Comment', name: 'No Comment' })
  expect(voices[7]).toMatchObject({ id: 'Empty Comment', name: 'Empty Comment' })
})

it('keeps the first entry of a repeated CLI name', () => {
  expect(parseVoiceList(catalog).filter(voice => voice.id === 'Tingting (中文（中国大陆）)')).toHaveLength(1)
})

it('maps locales to language hints following the Kokoro convention', () => {
  const voices = parseVoiceList(catalog)
  expect(voices[0]?.languages).toEqual(['auto', 'en'])
  expect(voices[2]?.languages).toEqual(['auto', 'zh', 'en'])
  expect(voices[5]?.languages).toEqual(['auto', 'de'])
})

it('selects voices by configured primary locale subtags', () => {
  const voices = parseVoiceList(catalog)
  expect(selectVoices(voices, ['zh']).map(voice => voice.id)).toEqual(['Tingting (中文（中国大陆）)', 'Meijia', 'Sinji'])
  expect(selectVoices(voices, ['zh', 'en']).map(voice => voice.id)).toEqual([
    'Alex', 'Bad News', 'Tingting (中文（中国大陆）)', 'Meijia', 'Sinji',
  ])
  expect(selectVoices(voices, ['ja'])).toEqual([])
})

it('parses an empty catalog into no voices', () => {
  expect(parseVoiceList('')).toEqual([])
})
