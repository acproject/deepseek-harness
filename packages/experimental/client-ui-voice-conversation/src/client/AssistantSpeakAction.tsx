/**
 * Manual per-reply speech playback entry in the assistant actions strip.
 * Clicking splits the finalized reply into speakable sentences (same splitter
 * as the always-on loop, capped by the catalog's maxTextChars), synthesizes
 * them serially through the TTS Remote, caches decoded AudioBuffers per
 * sentence so replays start instantly, and plays them back to back through one
 * module-level source: starting another reply stops the current one.
 * @module @deepseek-ai/dsh-experimental-client-ui-voice-conversation/client/AssistantSpeakAction
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { IconPlayOutlineRegular, IconStopFillRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-chat SlotMap merge (the assistant-actions entry).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SynthesizedAudioWire,
  SynthesisRequestWire,
} from '@deepseek-ai/dsh-experimental-api-text-to-speech/types'
import type { TtsReadiness } from './readiness.ts'
import { decodeBase64ToBytes } from './controller.ts'
import { hasSpeakable, splitSpeech } from './segment.ts'
import { NS } from './locales.ts'
import css from './AssistantSpeakAction.module.css'

/** Injected face of the speak entry: TTS readiness and the synthesis verb. */
export interface AssistantSpeakInjected {
  hooks: {
    /** Selection and provider readiness observed by the mount's catalog store. */
    ttsReadiness: HostObservable<TtsReadiness>
  }
  /** Synthesize text through the same Remote the always-on loop uses. */
  synthesize: (request: SynthesisRequestWire, signal: AbortSignal) => Promise<RemoteResult<SynthesizedAudioWire>>
}

/** Full props of one assistant-reply speak entry. */
export type AssistantSpeakActionProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<AssistantSpeakInjected>
  & PropsLocale<typeof NS>

/** Decoded audio kept per reply sentence so replay starts without re-synthesis. */
const audioCache = new Map<string, AudioBuffer>()
const playingListeners = new Set<() => void>()
let playingKey: string | null = null
let activeSource: AudioBufferSourceNode | null = null
/** Incremented on every stop or new playback; stale loops exit on it. */
let playbackGeneration = 0
let audioContext: AudioContext | undefined

function notifyPlaying(): void {
  for (const listener of playingListeners) listener()
}

function subscribePlaying(listener: () => void): () => void {
  playingListeners.add(listener)
  return () => { playingListeners.delete(listener) }
}

function playingKeySnapshot(): string | null {
  return playingKey
}

async function ensureContext(): Promise<AudioContext> {
  audioContext ??= new AudioContext()
  if (audioContext.state === 'suspended') await audioContext.resume()
  return audioContext
}

async function decodeAudio(base64: string): Promise<AudioBuffer> {
  const bytes = decodeBase64ToBytes(base64)
  return await (await ensureContext()).decodeAudioData(bytes.slice().buffer)
}

function stopPlayback(): void {
  playbackGeneration += 1
  playingKey = null
  notifyPlaying()
  // stop() fires onended, resolving the pending playOne of the old loop.
  activeSource?.stop()
}

async function playOne(buffer: AudioBuffer): Promise<void> {
  const context = await ensureContext()
  return new Promise((resolve) => {
    const source = context.createBufferSource()
    source.buffer = buffer
    source.onended = () => { if (activeSource === source) activeSource = null; resolve() }
    source.connect(context.destination)
    activeSource = source
    source.start()
  })
}

/**
 * Play one reply's sentences in order, awaiting the loader so synthesis of the
 * next sentence overlaps the current one's playback.
 * @param key - reply identity exposed as the playing key.
 * @param loadSentence - resolve sentence audio by index, or undefined at the end.
 */
async function playSegments(key: string, loadSentence: (index: number) => Promise<AudioBuffer | undefined>): Promise<void> {
  const generation = ++playbackGeneration
  playingKey = key
  notifyPlaying()
  for (let index = 0; ; index += 1) {
    if (generation !== playbackGeneration) return
    const buffer = await loadSentence(index)
    if (buffer === undefined) break
    if (generation !== playbackGeneration) return
    await playOne(buffer)
  }
  if (generation === playbackGeneration) {
    playingKey = null
    notifyPlaying()
  }
}

/**
 * Split a finalized reply into speakable synthesis requests, each within the
 * catalog's length cap; the splitter's trailing remainder is already capped.
 * @param text - the finalized assistant reply.
 * @param maxChars - catalog maxTextChars, mirroring the loop's feed splitter.
 * @returns speakable sentences in reading order.
 */
function speakableSentences(text: string, maxChars: number): string[] {
  const split = splitSpeech(text, maxChars)
  const parts = [...split.complete]
  const tail = split.remainder.trim()
  if (tail !== '' && hasSpeakable(tail)) parts.push(tail)
  return parts
}

/**
 * One reply's speak control in the assistant actions strip.
 * @param props - the owner's message identity and reply text, plus the injected TTS verbs.
 * @returns the play/stop button with a transient failure notice.
 */
export function AssistantSpeakAction({ messageId, text, useTtsReadiness, synthesize, t }: AssistantSpeakActionProps) {
  const tts = useTtsReadiness(value => value)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const playing = useSyncExternalStore(subscribePlaying, playingKeySnapshot) === messageId
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  if (text.trim() === '') return null

  const toggle = (): void => {
    if (playing) { stopPlayback(); return }
    setFailure(null)
    const catalog = tts.catalog
    if (!tts.connected || catalog === null) { setFailure('tts not ready'); return }
    // Create/resume the context inside the click's user-activation window;
    // after the synthesis round trip a bare resume() can stay suspended.
    void ensureContext()
    const sentences = speakableSentences(text, catalog.maxTextChars)
    if (sentences.length === 0) return
    const requestFor = (sentence: string): SynthesisRequestWire => ({
      text: sentence,
      providerId: catalog.selection.providerId,
      voiceId: catalog.selection.voiceId,
      ...(catalog.selection.language === 'auto' ? {} : { language: catalog.selection.language }),
    })
    const loadSentence = async (index: number): Promise<AudioBuffer | undefined> => {
      const sentence = sentences[index]
      if (sentence === undefined) return undefined
      const cacheKey = `${messageId}#${index}`
      const cached = audioCache.get(cacheKey)
      if (cached !== undefined) return cached
      setBusy(true)
      try {
        const result = await synthesize(requestFor(sentence), new AbortController().signal)
        if (!result.ok) throw result.error
        const buffer = await decodeAudio(result.value.audioBase64)
        audioCache.set(cacheKey, buffer)
        return buffer
      } catch (error) {
        if (alive.current) {
          setFailure(error instanceof Error ? error.message : String(error))
          stopPlayback()
        }
        return undefined
      } finally {
        if (alive.current) setBusy(false)
      }
    }
    void playSegments(messageId, loadSentence)
  }

  return <>
    <Tooltip label={playing ? t('stopPlay') : t('play')} side="bottom">
      <button type="button" className={css.action} disabled={busy && !playing}
        aria-label={playing ? t('stopPlay') : t('play')} onClick={toggle}>
        {playing ? <IconStopFillRegular /> : <IconPlayOutlineRegular />}
      </button>
    </Tooltip>
    {failure !== null && <span className={css.failure} role="alert">{t('playError')} ({failure})</span>}
  </>
}
