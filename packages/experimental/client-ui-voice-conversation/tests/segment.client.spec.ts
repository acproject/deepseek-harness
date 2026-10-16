import { describe, expect, it } from 'vitest'
import { normalizeForEcho, splitSpeech, stripCodeFences } from '../src/client/segment.ts'

describe('stripCodeFences', () => {
  it('removes complete fenced blocks with their language tag', () => {
    expect(stripCodeFences('before\n```ts\nconst a = 1\n```\nafter')).toBe('before\n\nafter')
  })

  it('hides an unterminated fence at the tail', () => {
    expect(stripCodeFences('说明：\n```js\nconst partial = true')).toBe('说明：\n')
  })

  it('keeps inline code text without backticks', () => {
    expect(stripCodeFences('调用 `run()` 即可')).toBe('调用 run() 即可')
  })
})

describe('splitSpeech', () => {
  it('splits Chinese and English terminators and keeps the open remainder', () => {
    expect(splitSpeech('你好。世界！Still? typing', 500).complete).toEqual(['你好。', '世界！', 'Still?'])
    expect(splitSpeech('你好。世界', 500).remainder).toBe('世界')
  })

  it('attaches closing quotes and brackets to the terminator', () => {
    expect(splitSpeech('他说“好”。然后走了', 500).complete).toEqual(['他说“好”。'])
    expect(splitSpeech('Done.") Next', 500).complete).toEqual(['Done.")'])
  })

  it('treats an ellipsis run as one terminator', () => {
    const split = splitSpeech('Wait... go', 500)
    expect(split.complete).toEqual(['Wait...'])
    expect(split.remainder).toBe(' go')
  })

  it('is prefix-stable as deltas grow', () => {
    const first = splitSpeech('第一句。第二', 500)
    const second = splitSpeech('第一句。第二句。', 500)
    expect(second.complete[0]).toBe(first.complete[0])
    expect(second.complete[0]).toBe('第一句。')
    expect(second.complete[1]).toBe('第二句。')
  })

  it('caps an over-long sentence at the last clause separator', () => {
    const text = `${'a'.repeat(10)}，${'b'.repeat(10)}！tail`
    const split = splitSpeech(text, 20)
    expect(split.complete[0]).toBe(`${'a'.repeat(10)}，`)
    expect(split.complete.join('') + split.remainder).toBe(text)
  })

  it('hard-cuts by code point (not UTF-16 code units) when no separator exists', () => {
    const text = '中'.repeat(30)
    const split = splitSpeech(text, 10)
    expect(split.complete[0]).toBe('中'.repeat(10))
    expect(Array.from(split.complete[0] as string)).toHaveLength(10)
    expect(split.complete.join('') + split.remainder).toBe(text)
  })

  it('does not emit fenced code as speech', () => {
    const split = splitSpeech('看代码：\n```\nx.y()\n```\n结束。', 500)
    expect(split.complete.join('')).not.toContain('x.y')
    expect(split.complete).toContain('结束。')
  })

  it('skips empty segments', () => {
    expect(splitSpeech('。。。a。', 500).complete).toEqual(['a。'])
  })
})

describe('normalizeForEcho', () => {
  it('lowercases and strips punctuation and whitespace', () => {
    expect(normalizeForEcho(' Hello, World! ')).toBe('helloworld')
  })

  it('keeps CJK ideographs and digits', () => {
    expect(normalizeForEcho('第 1 点：OK。')).toBe('第1点ok')
  })
})
