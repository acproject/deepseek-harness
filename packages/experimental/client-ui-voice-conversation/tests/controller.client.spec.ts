/**
 * Behavior tests for the always-on voice loop. Device seams are fakes; only
 * text flow, barge-in ordering, echo rejection and synthesis scheduling run.
 */
import { createAssistantMessage, type LlmAttemptId } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import { MutableSessionEventSource, type SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { SpeechCatalog } from '@deepseek-ai/dsh-experimental-api-speech-to-text/types'
import type { SynthesisProviderId } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import type {
  SynthesizedAudioWire,
  TtsCatalog,
} from '@deepseek-ai/dsh-experimental-api-text-to-speech/types'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { CaptureError, type CaptureHandlers } from '../src/client/capture.ts'
import {
  VoiceController,
  VoiceError,
  type CaptureLike,
  type ControllerPieces,
  type PlaybackLike,
  type VoiceConversationDeps,
} from '../src/client/controller.ts'
import type { SpeechPlaybackHandlers } from '../src/client/playback.ts'
import type { SpeechReadiness, TtsReadiness } from '../src/client/readiness.ts'

const SPEECH_PROVIDER = 'sensevoice-local' as SpeechProviderId
const TTS_PROVIDER = 'kokoro-local' as SynthesisProviderId
const ATTEMPT = 'att-1' as LlmAttemptId

function speechCatalog(phase: string = 'ready'): SpeechCatalog {
  return {
    providers: [{
      id: SPEECH_PROVIDER,
      name: 'SenseVoice',
      location: 'host-local',
      languages: ['auto', 'zh', 'en'],
      preparation: { phase: phase as 'ready' },
    }],
    selection: { providerId: SPEECH_PROVIDER, language: 'auto' },
    maxAudioBytes: 5_000_000,
    maxDurationSeconds: 30,
  }
}

function ttsCatalog(phase: string = 'ready'): TtsCatalog {
  return {
    providers: [{
      id: TTS_PROVIDER,
      name: 'Kokoro',
      location: 'host-local',
      voices: [{ id: 'zf_xiaobei', name: 'Xiaobei', languages: ['auto', 'zh', 'en'] }],
      preparation: { phase: phase as 'ready' },
    }],
    selection: { providerId: TTS_PROVIDER, voiceId: 'zf_xiaobei', language: 'auto' },
    maxTextChars: 500,
    maxAudioBytes: 16_000_000,
  }
}

const AUDIO: SynthesizedAudioWire = {
  audioBase64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEA',
  mimeType: 'audio/wav',
  sampleRate: 24000,
  audioSeconds: 0.1,
  synthesisSeconds: 0.05,
}

interface FakePlayback extends Omit<PlaybackLike, 'cancelAll' | 'enqueue'> {
  handlers: SpeechPlaybackHandlers
  setSpeaking(value: boolean): void
  enqueue: Mock<PlaybackLike['enqueue']>
  cancelAll: Mock<PlaybackLike['cancelAll']>
  enqueued: Array<{ key: string; text: string }>
}

interface Harness {
  controller: VoiceController
  events: MutableSessionEventSource
  captureHandlers: CaptureHandlers
  playback: FakePlayback
  speech: SnapshotStore<SpeechReadiness>
  tts: SnapshotStore<TtsReadiness>
  send: Mock<VoiceConversationDeps['send']>
  cancel: Mock<VoiceConversationDeps['cancel']>
  transcribe: Mock<VoiceConversationDeps['transcribe']>
  synthesize: Mock<VoiceConversationDeps['synthesize']>
  setRunning(value: boolean): void
  segment(samples?: Float32Array): void
  notifyEvents(): void
}

function makeHarness(options: {
  speechConnected?: boolean
  speechPhase?: string
  ttsConnected?: boolean
  ttsPhase?: string
  transcript?: string
  pieces?: ControllerPieces
} = {}): Harness {
  const speech = createSnapshotStore<SpeechReadiness>({
    catalog: options.speechConnected === false ? null : speechCatalog(options.speechPhase),
    connected: options.speechConnected !== false,
    error: null,
  })
  const tts = createSnapshotStore<TtsReadiness>({
    catalog: options.ttsConnected === false ? null : ttsCatalog(options.ttsPhase),
    connected: options.ttsConnected !== false,
    error: null,
  })
  const events = new MutableSessionEventSource()
  const eventListeners = new Set<() => void>()
  const sessionListeners = new Set<() => void>()
  let running = false

  const send = vi.fn(async () => undefined)
  const cancel = vi.fn(async () => undefined)
  const transcribe = vi.fn(async () => ({
    ok: true as const,
    value: { text: options.transcript ?? '你好世界', audioSeconds: 1, inferenceSeconds: 0.5 },
  }))
  const synthesize = vi.fn(async () => ({ ok: true as const, value: AUDIO }))

  let captureHandlers!: CaptureHandlers
  const capture: CaptureLike = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    amplitude: vi.fn(() => 0.2),
    setPlaybackActive: vi.fn(),
  }
  let speaking = false
  const enqueued: Array<{ key: string; text: string }> = []
  let playbackHandlers!: SpeechPlaybackHandlers
  const playback: FakePlayback = {
    get handlers() { return playbackHandlers },
    get speaking() { return speaking },
    setSpeaking: (value) => { speaking = value },
    enqueue: vi.fn((key: string, text: string) => { enqueued.push({ key, text }) }),
    cancelAll: vi.fn(),
    dispose: vi.fn(async () => undefined),
    enqueued,
  }
  const pieces: ControllerPieces = {
    makeCapture: (handlers) => { captureHandlers = handlers; return capture },
    makePlayback: (handlers) => { playbackHandlers = handlers; return playback },
    ...options.pieces,
  }

  const deps: VoiceConversationDeps = {
    speech,
    tts,
    send,
    cancel,
    subscribeSession: (listener) => { sessionListeners.add(listener); return () => sessionListeners.delete(listener) },
    sessionRunning: () => running,
    subscribeEvents: (listener) => { eventListeners.add(listener); return () => eventListeners.delete(listener) },
    eventWindow: () => events.getSnapshot(),
    transcribe,
    synthesize,
  }
  const controller = new VoiceController(deps, pieces)

  return {
    controller,
    events,
    get captureHandlers() { return captureHandlers },
    playback,
    speech,
    tts,
    send,
    cancel,
    transcribe,
    synthesize,
    setRunning: (value) => {
      running = value
      for (const listener of sessionListeners) listener()
    },
    segment: (samples = new Float32Array(16000).fill(0.3)) => {
      captureHandlers.onGateState('silence')
      captureHandlers.onSegmentStart()
      captureHandlers.onSegment(samples)
    },
    notifyEvents: () => { for (const listener of eventListeners) listener() },
  }
}

let eventSeq = 1

function chunkEntry(text: string): SessionEventLikeEntry {
  const seq = eventSeq++
  return {
    type: 'transient',
    event: {
      type: 'assistant/live-chunk',
      seq,
      time: seq,
      data: { attemptId: ATTEMPT, turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text } },
    },
  }
}

function messageEvent(seqNumber: number, text: string, interrupted = false): SessionEvent<'assistant/message'> {
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

describe('VoiceController', () => {
  it('refuses to start before either catalog is connected', async () => {
    const offline = makeHarness({ speechConnected: false })
    await expect(offline.controller.start('')).rejects.toMatchObject({ name: 'VoiceError', kind: 'not-ready' })

    const preparing = makeHarness({ ttsPhase: 'downloading' })
    await expect(preparing.controller.start('')).rejects.toBeInstanceOf(VoiceError)
    expect(preparing.controller.state.getSnapshot().phase).toBe('off')
  })

  it('transcribes one segment and submits the transcript as a normal turn', async () => {
    const harness = makeHarness()
    await harness.controller.start('')
    harness.captureHandlers.onGateState('silence')
    expect(harness.controller.state.getSnapshot().phase).toBe('listening')

    harness.segment()
    await vi.waitFor(() => { expect(harness.send).toHaveBeenCalledWith('你好世界') })
    expect(harness.transcribe).toHaveBeenCalledOnce()
    expect(harness.controller.state.getSnapshot().phase).toBe('listening')
    await harness.controller.dispose()
  })

  it('drops segments whose transcript has no speakable content', async () => {
    const harness = makeHarness({ transcript: '。。。' })
    await harness.controller.start('')
    harness.segment()
    await vi.waitFor(() => { expect(harness.transcribe).toHaveBeenCalledOnce() })
    expect(harness.send).not.toHaveBeenCalled()
    await harness.controller.dispose()
  })

  it('rejects transcripts that normalize to recently spoken text', async () => {
    const harness = makeHarness({ transcript: '重复这句话测试回声守卫效果' })
    await harness.controller.start('')
    harness.playback.handlers.onStart('请重复这句话测试回声守卫效果')
    harness.segment()
    await vi.waitFor(() => { expect(harness.transcribe).toHaveBeenCalledOnce() })
    expect(harness.send).not.toHaveBeenCalled()
    await harness.controller.dispose()
  })

  it('cancels the running turn before submitting a barge-in utterance', async () => {
    const harness = makeHarness()
    const { send, cancel } = harness
    const order: string[] = []
    send.mockImplementation(() => {
      order.push('send')
      return Promise.resolve()
    })
    cancel.mockImplementation(() => {
      order.push('cancel')
      return Promise.resolve()
    })
    await harness.controller.start('')
    harness.playback.handlers.onStart('正在朗读的回答内容')
    harness.setRunning(true)

    harness.segment()
    await vi.waitFor(() => { expect(send).toHaveBeenCalledWith('你好世界') })
    expect(order).toEqual(['cancel', 'send'])
    await harness.controller.dispose()
  })

  it('surfaces transcription Remote failures without submitting', async () => {
    const harness = makeHarness()
    harness.transcribe.mockResolvedValue({
      ok: false,
      error: new RemoteError('speech/transcription-failed', 'boom', { reason: 'boom' }),
    })
    await harness.controller.start('')
    harness.segment()
    await vi.waitFor(() => { expect(harness.controller.state.getSnapshot().error?.kind).toBe('transcribe-failed') })
    expect(harness.send).not.toHaveBeenCalled()
    await harness.controller.dispose()
  })

  it('synthesizes complete sentences in order and enqueues the tail at settlement', async () => {
    const harness = makeHarness()
    await harness.controller.start('')
    harness.setRunning(true)

    harness.events.append(chunkEntry('第一句话。第二句还'))
    harness.notifyEvents()
    await vi.waitFor(() => { expect(harness.synthesize).toHaveBeenCalledOnce() })

    harness.events.settleAssistant(ATTEMPT, { type: 'event', event: messageEvent(100, '第一句话。第二句话还没说完') })
    harness.notifyEvents()
    await vi.waitFor(() => { expect(harness.synthesize).toHaveBeenCalledTimes(2) })

    const texts = harness.synthesize.mock.calls.map(call => call[0].text)
    expect(texts).toEqual(['第一句话。', '第二句话还没说完'])
    const request = harness.synthesize.mock.calls[0]?.[0]
    expect(request?.providerId).toBe(TTS_PROVIDER)
    expect(request?.voiceId).toBe('zf_xiaobei')
    expect(harness.playback.enqueued.map(item => item.key)).toEqual(['att-1#0', 'att-1#tail'])
    await harness.controller.dispose()
  })

  it('aborts pending synthesis and playback on an interrupted settlement', async () => {
    const harness = makeHarness()
    const { synthesize } = harness
    const { cancelAll } = harness.playback
    synthesize.mockImplementation(() => new Promise<never>(() => undefined))
    await harness.controller.start('')
    harness.setRunning(true)

    harness.events.append(chunkEntry('正在说的第一句。'))
    harness.notifyEvents()
    await vi.waitFor(() => { expect(synthesize).toHaveBeenCalledOnce() })
    const signal = synthesize.mock.calls[0]?.[1]
    expect(signal?.aborted).toBe(false)

    harness.events.settleAssistant(ATTEMPT, { type: 'event', event: messageEvent(100, '正在说的第一句。', true) })
    harness.notifyEvents()
    expect(signal?.aborted).toBe(true)
    expect(cancelAll).toHaveBeenCalled()
    await harness.controller.dispose()
  })

  it('stops the loop, cancels speech and ignores later segments', async () => {
    const harness = makeHarness()
    const { transcribe } = harness
    const { cancelAll } = harness.playback
    await harness.controller.start('')
    await harness.controller.stop()
    expect(harness.controller.state.getSnapshot().phase).toBe('off')
    expect(cancelAll).toHaveBeenCalled()

    harness.segment()
    await Promise.resolve()
    expect(transcribe).not.toHaveBeenCalled()
    await harness.controller.dispose()
  })

  it('maps capture errors to a localized capture failure and releases the mic', async () => {
    const harness = makeHarness()
    await harness.controller.start('')
    harness.captureHandlers.onError(new CaptureError('permission'))
    expect(harness.controller.state.getSnapshot()).toMatchObject({
      phase: 'off',
      error: { kind: 'capture-permission', message: null },
    })
    await harness.controller.dispose()
  })
})
