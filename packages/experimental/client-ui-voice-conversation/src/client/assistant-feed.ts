/**
 * Turns one Session binding's assistant event window into an ordered stream of
 * speakable sentences. Live `text-delta` chunks are split incrementally; the
 * durable `assistant/message` settlement emits the final open tail (or discards
 * the attempt when the turn was interrupted). Only text blocks are spoken;
 * reasoning, tool and usage chunks are ignored.
 */
import type { LlmAttemptId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type {
  AssistantLiveChunkEvent,
  SessionEventLikeEntry,
  SessionEventWindow,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { hasSpeakable, splitSpeech } from './segment.ts'

/** Sink for one attempt's ordered speech lifecycle. */
export interface AssistantSpeechHandler {
  /**
   * One complete sentence became available.
   * @param sentenceKey - unique key `${attemptId}#${index}` for cancellation.
   * @param attemptId - producing attempt.
   * @param text - sentence text.
   */
  onSentence(sentenceKey: string, attemptId: string, text: string): void
  /**
   * The attempt reached durable settlement.
   * @param attemptId - settled attempt.
   * @param interrupted - true for an interrupted prefix; pending speech must stop.
   */
  onSettled(attemptId: string, interrupted: boolean): void
  /** The attempt committed no surface message (retry, failure, abandonment). */
  onAbandoned(attemptId: string): void
}

interface AttemptState {
  readonly attemptId: LlmAttemptId
  streamed: string
  /** Complete-sentence count already delivered; preserved across rebaselines. */
  scheduled: number
}

/**
 * Incremental assistant-to-speech feed over one event source.
 * Construct inside the Session scope and subscribe the source to
 * {@link notify}; dispose the subscription when the scope ends.
 */
export class AssistantSpeechFeed {
  private readonly attempts = new Map<string, AttemptState>()
  private readonly handler: AssistantSpeechHandler
  private readonly maxChars: number
  private readonly baselineSeq: number
  private revision: number

  constructor(initial: SessionEventWindow, handler: AssistantSpeechHandler, maxChars: number) {
    this.handler = handler
    this.maxChars = maxChars
    this.revision = initial.revision
    let baseline = Number.NEGATIVE_INFINITY
    for (const entry of initial.entries) baseline = Math.max(baseline, entry.event.seq)
    this.baselineSeq = baseline
  }

  /**
   * Handle one published window snapshot; no-op when the revision is unchanged.
   * @param snapshot - current event-window snapshot from the binding source.
   */
  notify(snapshot: SessionEventWindow): void {
    if (snapshot.revision === this.revision) return
    this.revision = snapshot.revision
    const { change } = snapshot
    switch (change.kind) {
      case 'append':
        for (const entry of change.entries) this.handleEntry(entry)
        return
      case 'settle-assistant':
        this.handleSettlement(change.attemptId, change.entry)
        return
      case 'replace':
        this.handleReplace(change.entries)
        return
      case 'prepend':
        return
      default:
        assertUnreachable(change)
    }
  }

  private handleEntry(entry: SessionEventLikeEntry): void {
    if (entry.type !== 'transient') return
    this.appendChunk(entry.event)
  }

  private appendChunk(event: AssistantLiveChunkEvent): void {
    const { chunk, attemptId } = event.data
    if (chunk.type !== 'text-delta') return
    const key = attemptId as string
    let state = this.attempts.get(key)
    if (state === undefined) {
      state = { attemptId, streamed: '', scheduled: 0 }
      this.attempts.set(key, state)
    }
    state.streamed += chunk.text
    this.emitComplete(state)
  }

  private emitComplete(state: AttemptState): void {
    const { complete } = splitSpeech(state.streamed, this.maxChars)
    while (state.scheduled < complete.length) {
      const text = complete[state.scheduled]
      if (text !== undefined) {
        this.handler.onSentence(`${state.attemptId as string}#${state.scheduled}`, state.attemptId, text)
      }
      state.scheduled += 1
    }
  }

  private handleSettlement(
    attemptId: LlmAttemptId,
    entry: { readonly event: SessionEvent<'assistant/message'> | SessionEvent<'assistant/attempt'> } | undefined,
  ): void {
    const key = attemptId as string
    const state = this.attempts.get(key)
    this.attempts.delete(key)
    if (entry === undefined) {
      this.handler.onAbandoned(key)
      return
    }
    const { event } = entry
    if (event.seq <= this.baselineSeq) return
    if (event.type === 'assistant/attempt') {
      this.handler.onAbandoned(key)
      return
    }
    if (event.surfaceOp !== 'append') {
      this.handler.onSettled(key, true)
      return
    }
    if (event.data.interrupted === true) {
      this.handler.onSettled(key, true)
      return
    }
    const finalText = assistantText(event.data.message)
    const { complete, remainder } = splitSpeech(finalText, this.maxChars)
    const scheduled = state?.scheduled ?? 0
    for (let index = scheduled; index < complete.length; index += 1) {
      const text = complete[index]
      if (text !== undefined) this.handler.onSentence(`${key}#${index}`, key, text)
    }
    const tail = remainder.trim()
    if (hasSpeakable(tail)) this.handler.onSentence(`${key}#tail`, key, tail)
    this.handler.onSettled(key, false)
  }

  private handleReplace(entries: readonly SessionEventLikeEntry[]): void {
    const rebuilt = new Map<string, AttemptState>()
    for (const entry of entries) {
      if (entry.type !== 'transient') continue
      const { chunk, attemptId } = entry.event.data
      if (chunk.type !== 'text-delta') continue
      const key = attemptId as string
      let state = rebuilt.get(key)
      if (state === undefined) {
        state = { attemptId, streamed: '', scheduled: 0 }
        rebuilt.set(key, state)
      }
      state.streamed += chunk.text
    }
    for (const [key, state] of rebuilt) {
      const previous = this.attempts.get(key)
      const completeCount = splitSpeech(state.streamed, this.maxChars).complete.length
      state.scheduled = Math.max(previous?.scheduled ?? 0, completeCount)
    }
    this.attempts.clear()
    for (const [key, state] of rebuilt) this.attempts.set(key, state)
  }
}

/** Visible assistant message carried by a durable `assistant/message` event. */
type AssistantMessage = SessionEvent<'assistant/message'>['data']['message']

/**
 * Concatenate visible text blocks of one assistant message.
 * @param message - durable assistant message.
 * @returns text blocks joined on newlines, which the segmenter treats as stops.
 */
export function assistantText(message: AssistantMessage): string {
  return message.content
    .flatMap(block => (block.type === 'text' ? [block.text] : []))
    .join('\n')
}

function assertUnreachable(value: never): never {
  throw new Error(`unhandled event change: ${JSON.stringify(value)}`)
}
