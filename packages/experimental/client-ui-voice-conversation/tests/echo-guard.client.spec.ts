import { describe, expect, it, vi } from 'vitest'
import { EchoGuard } from '../src/client/echo-guard.ts'

function makeGuard(now = vi.fn(() => 1000)) {
  return new EchoGuard({ maxChars: 100, ttlMs: 1000, now })
}

describe('EchoGuard', () => {
  it('accepts short transcripts without judging them', () => {
    const guard = makeGuard()
    guard.remember('这是助手朗读的一长句内容')
    expect(guard.check('好的').accepted).toBe(true)
  })

  it('rejects a transcript matching recently spoken text in either direction', () => {
    const guard = makeGuard()
    guard.remember('你可以先整理一下今天的会议纪要。')
    const echo = guard.check('先整理一下今天的会议纪要')
    expect(echo.accepted).toBe(false)
    expect(echo.matched).toContain('先整理')

    expect(guard.check('我想问一个完全不同的新问题怎么办').accepted).toBe(true)
  })

  it('ignores punctuation, spacing and case when comparing', () => {
    const guard = makeGuard()
    guard.remember('Please open the settings panel.')
    expect(guard.check('please open the settings panel！').accepted).toBe(false)
  })

  it('forgets entries after the TTL', () => {
    const now = vi.fn(() => 1000)
    const guard = new EchoGuard({ maxChars: 100, ttlMs: 1000, now })
    guard.remember('记得提醒我明天下午三点开会讨论预算')
    now.mockReturnValue(2001)
    expect(guard.check('提醒我明天下午三点开会讨论预算').accepted).toBe(true)
  })

  it('trims the oldest entries once the ring is full', () => {
    const guard = makeGuard()
    guard.remember('a'.repeat(60))
    guard.remember('b'.repeat(60))
    expect(guard.check('a'.repeat(20)).accepted).toBe(true)
    expect(guard.check('b'.repeat(20)).accepted).toBe(false)
  })

  it('reset forgets all spoken text', () => {
    const guard = makeGuard()
    guard.remember('这段朗读内容应该被回声守卫拦截下来')
    guard.reset()
    expect(guard.check('回声守卫拦截下来').accepted).toBe(true)
  })
})
