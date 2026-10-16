import { createAssistantMessage, type LlmAttemptId } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import { MutableSessionEventSource, type SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { describe, expect, it, vi } from 'vitest'
import { AssistantSpeechFeed, type AssistantSpeechHandler } from '../src/client/assistant-feed.ts'

const ATTEMPT = 'att-1' as LlmAttemptId
let seq = 1

function resetSeq(): void {
  seq = 1
}

function chunkEntry(
  attemptId: LlmAttemptId,
  text: string,
  type: 'text-delta' | 'reasoning-delta' = 'text-delta',
): SessionEventLikeEntry {
  return {
    type: 'transient',
    event: {
      type: 'assistant/live-chunk',
      seq: seq++,
      time: seq,
      data: { attemptId, turn: 1, step: 0, chunk: { type, index: 0, text } },
    },
  }
}

function messageEvent(
  seqNumber: number,
  text: string,
  interrupted = false,
): SessionEvent<'assistant/message'> {
  const message = createAssistantMessage({
    content: [{ type: 'text', text }],
    source: { provider: 'test', model: 'test' },
  })
  return {
    type: 'assistant/message',
    seq: SessionSeq(seqNumber),
    time: seqNumber,
    data: {
      turn: 1,
      step: 0,
      message,
      stream: [],
      ...(interrupted ? { interrupted: true as const } : {}),
    },
    surfaceOp: 'append',
  }
}

function attemptSettlementEvent(seqNumber: number): SessionEvent<'assistant/attempt'> {
  return { type: 'assistant/attempt', seq: SessionSeq(seqNumber), time: seqNumber, data: { turn: 1, step: 0, stream: [] } }
}

interface FeedHarness {
  source: MutableSessionEventSource
  feed: AssistantSpeechFeed
  handler: AssistantSpeechHandler & { calls: string[][] }
}

function makeFeed(): FeedHarness {
  const source = new MutableSessionEventSource()
  const calls: string[][] = []
  const handler: AssistantSpeechHandler = {
    onSentence: vi.fn((key: string, _attemptId: string, text: string) => calls.push(['sentence', key, text])),
    onSettled: vi.fn((attemptId: string, interrupted: boolean) => calls.push(['settled', attemptId, String(interrupted)])),
    onAbandoned: vi.fn((attemptId: string) => calls.push(['abandoned', attemptId])),
  }
  const feed = new AssistantSpeechFeed(source.getSnapshot(), handler, 500)
  return { source, feed, handler: Object.assign(handler, { calls }) }
}

describe('AssistantSpeechFeed', () => {
  it('emits complete sentences live and the open remainder at settlement', () => {
    resetSeq()
    const { source, feed, handler } = makeFeed()
    source.append(chunkEntry(ATTEMPT, '你好。'))
    feed.notify(source.getSnapshot())
    source.append(chunkEntry(ATTEMPT, '第二句还没'))
    feed.notify(source.getSnapshot())
    source.settleAssistant(ATTEMPT, { type: 'event', event: messageEvent(100, '你好。第二句还没想好') })
    feed.notify(source.getSnapshot())

    expect(handler.calls).toEqual([
      ['sentence', 'att-1#0', '你好。'],
      ['sentence', 'att-1#tail', '第二句还没想好'],
      ['settled', 'att-1', 'false'],
    ])
  })

  it('emits sentences first seen in the durable message without duplicates', () => {
    resetSeq()
    const { source, feed, handler } = makeFeed()
    source.append(chunkEntry(ATTEMPT, '你好。'))
    feed.notify(source.getSnapshot())
    source.settleAssistant(ATTEMPT, { type: 'event', event: messageEvent(100, '你好。再见。') })
    feed.notify(source.getSnapshot())
    expect(handler.calls).toEqual([
      ['sentence', 'att-1#0', '你好。'],
      ['sentence', 'att-1#1', '再见。'],
      ['settled', 'att-1', 'false'],
    ])
  })

  it('discards pending speech on an interrupted settlement', () => {
    resetSeq()
    const { source, feed, handler } = makeFeed()
    source.append(chunkEntry(ATTEMPT, '说到一半'))
    feed.notify(source.getSnapshot())
    source.settleAssistant(ATTEMPT, { type: 'event', event: messageEvent(100, '说到一半', true) })
    feed.notify(source.getSnapshot())
    expect(handler.calls).toEqual([['settled', 'att-1', 'true']])
  })

  it('reports attempts that committed no message as abandoned', () => {
    resetSeq()
    const { source, feed, handler } = makeFeed()
    source.settleAssistant(ATTEMPT, { type: 'event', event: attemptSettlementEvent(100) })
    feed.notify(source.getSnapshot())
    expect(handler.calls).toEqual([['abandoned', 'att-1']])
  })

  it('reports settlement without entry as abandoned', () => {
    resetSeq()
    const { source, feed, handler } = makeFeed()
    source.settleAssistant(ATTEMPT)
    feed.notify(source.getSnapshot())
    expect(handler.calls).toEqual([['abandoned', 'att-1']])
  })

  it('speaks a durable message that arrives without live chunks', () => {
    resetSeq()
    const { source, feed, handler } = makeFeed()
    source.settleAssistant(ATTEMPT, { type: 'event', event: messageEvent(100, '直接朗读这句。') })
    feed.notify(source.getSnapshot())
    expect(handler.calls).toEqual([
      ['sentence', 'att-1#0', '直接朗读这句。'],
      ['settled', 'att-1', 'false'],
    ])
  })

  it('ignores durable events at or before the activation baseline', () => {
    resetSeq()
    const source = new MutableSessionEventSource()
    source.append({ type: 'event', event: messageEvent(5, '历史内容。') })
    const calls: string[][] = []
    const handler: AssistantSpeechHandler = {
      onSentence: vi.fn((key: string, _attemptId: string, text: string) => calls.push(['sentence', key, text])),
      onSettled: vi.fn((attemptId: string) => calls.push(['settled', attemptId, 'false'])),
      onAbandoned: vi.fn((attemptId: string) => calls.push(['abandoned', attemptId])),
    }
    const feed = new AssistantSpeechFeed(source.getSnapshot(), handler, 500)
    source.settleAssistant(ATTEMPT, { type: 'event', event: messageEvent(5, '历史内容。') })
    feed.notify(source.getSnapshot())
    expect(calls).toEqual([])
  })

  it('preserves scheduled counts across a window replace', () => {
    resetSeq()
    const { source, feed, handler } = makeFeed()
    source.append(chunkEntry(ATTEMPT, '你好。'))
    feed.notify(source.getSnapshot())
    source.replace([chunkEntry(ATTEMPT, '你好。再')], false)
    feed.notify(source.getSnapshot())
    source.settleAssistant(ATTEMPT, { type: 'event', event: messageEvent(100, '你好。再见。') })
    feed.notify(source.getSnapshot())
    expect(handler.calls).toEqual([
      ['sentence', 'att-1#0', '你好。'],
      ['sentence', 'att-1#1', '再见。'],
      ['settled', 'att-1', 'false'],
    ])
  })

  it('ignores non-text live chunks', () => {
    resetSeq()
    const { source, feed, handler } = makeFeed()
    source.append(chunkEntry(ATTEMPT, '推理内容', 'reasoning-delta'))
    feed.notify(source.getSnapshot())
    source.settleAssistant(ATTEMPT, { type: 'event', event: messageEvent(100, '') })
    feed.notify(source.getSnapshot())
    expect(handler.calls).toEqual([['settled', 'att-1', 'false']])
  })
})
