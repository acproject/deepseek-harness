/** Always-on voice conversation activity toggle and live phase row. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Button, IconMicrophoneOutlineRegular, IconStopFillRegular, StateDot, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SpeechReadiness } from './readiness.ts'
import type { TtsReadiness } from './readiness.ts'
import type { MicrophoneDevice } from './microphone-device.ts'
import type { VoiceErrorKind, VoiceUiState } from './controller.ts'
import { VoiceError } from './controller.ts'
import { NS } from './locales.ts'
import css from './VoiceConversation.module.css'

/** Host calls injected without exposing a Cordis Context to React. */
export interface VoiceConversationActions {
  /** Open the voice conversation bundle details. */
  openSettings: () => void
  /** Start the always-on loop on the preferred microphone (empty id = system default). */
  start: (deviceId: string) => Promise<void>
  /** Stop listening, cancel speech and release the microphone. */
  stop: () => Promise<void>
  /** Skip or resume synthesizing replies without stopping the loop. */
  setMuted: (muted: boolean) => void
  /** Dispose the per-Session controller when the activity unmounts. */
  release: () => Promise<void>
  /** Latest microphone RMS for the live level meter. */
  getAmplitude: () => number
  /** Remember the browser microphone used by subsequent starts. */
  selectMicrophone: (device: MicrophoneDevice) => void
}

/** Entry-injected Host readiness, loop state and operations. */
export interface VoiceConversationInjected extends VoiceConversationActions {
  readonly hooks: {
    readonly speechReadiness: HostObservable<SpeechReadiness>
    readonly ttsReadiness: HostObservable<TtsReadiness>
    readonly voiceState: HostObservable<VoiceUiState>
    readonly microphoneDevice: HostObservable<MicrophoneDevice>
  }
}

/** Composer-owned activity seat; the voice loop owns its own Session turns. */
export type VoiceConversationProps = Pick<PropsRuntime<'conversation.input.activity'>, 'sessionId' | 'locked' | 'onActiveChange'>
  & PropsLocale<typeof NS> & InjectFace<VoiceConversationInjected>

function usablePhase(readiness: SpeechReadiness | TtsReadiness): boolean {
  const catalog = readiness.catalog
  if (!readiness.connected || catalog === null) return false
  const provider = catalog.providers.find(item => item.id === catalog.selection.providerId)
  return provider?.preparation.phase === 'ready' || provider?.preparation.phase === 'standby'
}

/** Render the mic toggle or the expanded always-on phase row. */
export function VoiceConversation({ sessionId, locked, onActiveChange, t,
  useSpeechReadiness, useTtsReadiness, useVoiceState, useMicrophoneDevice,
  start, stop, release, getAmplitude, openSettings, setMuted }: VoiceConversationProps) {
  const speech = useSpeechReadiness(value => value)
  const tts = useTtsReadiness(value => value)
  const voice = useVoiceState(value => value)
  const microphone = useMicrophoneDevice(value => value)
  const ready = usablePhase(speech) && usablePhase(tts)
  const active = voice.phase !== 'off'
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<VoiceErrorKind | null>(null)
  const [level, setLevel] = useState(0)
  const generation = useRef(0)
  const activeRef = useRef(active)
  activeRef.current = active

  useLayoutEffect(() => { onActiveChange(active); return () => { onActiveChange(false) } }, [active, onActiveChange])

  useEffect(() => {
    const run = ++generation.current
    setStarting(false)
    setStartError(null)
    const visibility = (): void => { if (document.hidden && activeRef.current) void stop() }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      if (run === generation.current) void release()
    }
  }, [sessionId, stop, release])

  useEffect(() => {
    if (!active) { setLevel(0); return }
    let frame = 0
    const tick = (): void => { setLevel(getAmplitude()); frame = requestAnimationFrame(tick) }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame) }
  }, [active, getAmplitude])

  const toggle = async (): Promise<void> => {
    if (active) { await stop(); return }
    if (!ready) { openSettings(); return }
    const run = ++generation.current
    setStarting(true)
    setStartError(null)
    try {
      await start(microphone.id)
    } catch (error) {
      if (run === generation.current) setStartError(error instanceof VoiceError ? error.kind : 'capture-unavailable')
    } finally {
      if (run === generation.current) setStarting(false)
    }
  }

  const errorKind = startError ?? voice.error?.kind ?? null
  if (!active) return <Tooltip label={ready ? t('start') : t('error.not-ready')} disabled={locked} side="top" portal>
    <span className={css.triggerAnchor}>
      <Button className={css.trigger} size="sm" disabled={locked || starting}
        aria-label={ready ? t('start') : t('setupPrompt.open')}
        aria-haspopup={ready ? undefined : 'dialog'}
        onMouseDown={(event) => { event.preventDefault() }}
        onClick={() => { void toggle() }}>
        <IconMicrophoneOutlineRegular size={18} />
      </Button>
    </span>
  </Tooltip>

  return <div className={css.row} data-voice-phase={voice.phase}>
    <Button type="button" className={css.roundButton} size="sm" aria-label={t('stop')}
      onClick={() => { void stop() }}>
      <IconStopFillRegular size={14} />
    </Button>
    <span className={css.level} aria-hidden="true">
      <span className={css.levelFill} style={{ width: `${Math.min(100, Math.round(level * 200))}%` }} />
    </span>
    <span className={css.phase} role="status">
      <StateDot state={voice.phase === 'listening' ? 'done' : 'ongoing'} size={12} />
      {t(`phase.${voice.phase}`)}
    </span>
    <Button type="button" className={css.mute} size="sm" aria-pressed={voice.muted}
      aria-label={voice.muted ? t('unmute') : t('mute')}
      onClick={() => { setMuted(!voice.muted) }}>
      {voice.muted ? t('unmute') : t('mute')}
    </Button>
    {voice.speakerWarning && <span className={css.notice}>{t('speakerWarning')}</span>}
    {errorKind !== null && <span className={css.error} role="alert">
      {t(`error.${errorKind}`)}{voice.error?.message ? ` (${voice.error.message})` : ''}
    </span>}
  </div>
}
