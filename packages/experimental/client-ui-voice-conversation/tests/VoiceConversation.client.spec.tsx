// @vitest-environment jsdom
/** The activity control reflects loop state and routes start/stop to Host actions. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SpeechCatalog } from '@deepseek-ai/dsh-experimental-api-speech-to-text/types'
import type { TtsCatalog } from '@deepseek-ai/dsh-experimental-api-text-to-speech/types'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { SynthesisProviderId } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import { VoiceConversation, type VoiceConversationProps } from '../src/client/VoiceConversation.tsx'
import { VoiceConfigCard, type VoiceConfigProps } from '../src/client/PreparationCard.tsx'
import type { SpeechReadiness, TtsReadiness } from '../src/client/readiness.ts'
import type { MicrophoneDevice } from '../src/client/microphone-device.ts'
import type { VoiceUiState } from '../src/client/controller.ts'

afterEach(() => { cleanup() })

const speechCatalog: SpeechCatalog = {
  providers: [{
    id: 'sensevoice-local' as SpeechProviderId,
    name: 'SenseVoice',
    location: 'host-local',
    languages: ['auto', 'zh', 'en'],
    preparation: { phase: 'ready' },
  }],
  selection: { providerId: 'sensevoice-local' as SpeechProviderId, language: 'auto' },
  maxAudioBytes: 5_000_000,
  maxDurationSeconds: 30,
}

const ttsCatalog: TtsCatalog = {
  providers: [{
    id: 'kokoro-local' as SynthesisProviderId,
    name: 'Kokoro',
    location: 'host-local',
    voices: [{ id: 'zf_xiaobei', name: 'Xiaobei', languages: ['auto', 'zh', 'en'] }],
    preparation: { phase: 'ready' },
  }],
  selection: { providerId: 'kokoro-local' as SynthesisProviderId, voiceId: 'zf_xiaobei', language: 'auto' },
  maxTextChars: 500,
  maxAudioBytes: 16_000_000,
}

function selectorHook<T>(store: SnapshotStore<T>) {
  return <R,>(selector: (value: T) => R): R => useSyncExternalStore(
    listener => store.subscribe(listener),
    () => selector(store.getSnapshot()),
  )
}

interface ActivityHarness {
  props: VoiceConversationProps
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  release: ReturnType<typeof vi.fn>
  openSettings: ReturnType<typeof vi.fn>
  voice: SnapshotStore<VoiceUiState>
}

function makeActivityProps(overrides: {
  speech?: SpeechReadiness
  voice?: VoiceUiState
} = {}): ActivityHarness {
  const speech = createSnapshotStore<SpeechReadiness>(overrides.speech ?? { catalog: speechCatalog, connected: true, error: null })
  const tts = createSnapshotStore<TtsReadiness>({ catalog: ttsCatalog, connected: true, error: null })
  const voice = createSnapshotStore<VoiceUiState>(overrides.voice ?? { phase: 'off', muted: false, speakerWarning: false, error: null })
  const microphone = createSnapshotStore<MicrophoneDevice>({ id: '', label: '' })
  const start = vi.fn(async () => undefined)
  const stop = vi.fn(async () => undefined)
  const release = vi.fn(async () => undefined)
  const openSettings = vi.fn()
  const props: VoiceConversationProps = {
    sessionId: 's1' as never,
    locked: false,
    onActiveChange: vi.fn(),
    t: key => key,
    useSpeechReadiness: selectorHook(speech),
    useTtsReadiness: selectorHook(tts),
    useVoiceState: selectorHook(voice),
    useMicrophoneDevice: selectorHook(microphone),
    openSettings,
    start,
    stop,
    release,
    getAmplitude: () => 0,
    selectMicrophone: vi.fn(),
    setMuted: vi.fn(),
  }
  return { props, start, stop, release, openSettings, voice }
}

it('starts the loop with the saved microphone when both services are ready', () => {
  const { props, start } = makeActivityProps()
  const view = render(<VoiceConversation {...props} />)
  fireEvent.click(view.getByRole('button', { name: 'start' }))
  expect(start).toHaveBeenCalledWith('')
})

it('opens bundle settings when a service is not ready', () => {
  const { props, openSettings } = makeActivityProps({ speech: { catalog: null, connected: false, error: null } })
  const view = render(<VoiceConversation {...props} />)
  fireEvent.click(view.getByRole('button'))
  expect(openSettings).toHaveBeenCalledOnce()
})

it('renders the live phase row, warning and error while active', () => {
  const { props, stop, voice } = makeActivityProps({
    voice: { phase: 'speaking', muted: false, speakerWarning: true, error: { kind: 'synthesize-failed', message: null } },
  })
  const view = render(<VoiceConversation {...props} />)
  expect(view.getByRole('status').textContent).toContain('phase.speaking')
  expect(view.getByText('speakerWarning')).toBeTruthy()
  expect(view.getByRole('alert').textContent).toBe('error.synthesize-failed')
  fireEvent.click(view.getByRole('button', { name: 'stop' }))
  expect(stop).toHaveBeenCalledOnce()
  view.unmount()
  voice.set({ ...voice.getSnapshot(), phase: 'off' })
})

it('appends the underlying error message to the alert text when present', () => {
  const { props } = makeActivityProps({
    voice: { phase: 'listening', muted: false, speakerWarning: false, error: { kind: 'synthesize-failed', message: 'worker exited' } },
  })
  const view = render(<VoiceConversation {...props} />)
  expect(view.getByRole('alert').textContent).toBe('error.synthesize-failed (worker exited)')
  view.unmount()
})

it('releases the per-session loop on unmount', () => {
  const { props, release } = makeActivityProps()
  const view = render(<VoiceConversation {...props} />)
  view.unmount()
  expect(release).toHaveBeenCalledOnce()
})

it('routes preparation card selections to the Host actions', () => {
  const speech = createSnapshotStore<SpeechReadiness>({ catalog: speechCatalog, connected: true, error: null })
  const tts = createSnapshotStore<TtsReadiness>({ catalog: ttsCatalog, connected: true, error: null })
  const microphone = createSnapshotStore<MicrophoneDevice>({ id: '', label: '' })
  const prepareSpeech = vi.fn(async () => undefined)
  const cancelSpeechPreparation = vi.fn(async () => undefined)
  const prepareTts = vi.fn(async () => undefined)
  const cancelTtsPreparation = vi.fn(async () => undefined)
  const configureSpeech = vi.fn(async () => undefined)
  const configureTts = vi.fn(async () => undefined)
  const props: VoiceConfigProps = {
    t: key => key,
    useSpeechReadiness: selectorHook(speech),
    useTtsReadiness: selectorHook(tts),
    useMicrophoneDevice: selectorHook(microphone),
    prepareSpeech,
    cancelSpeechPreparation,
    prepareTts,
    cancelTtsPreparation,
    configureSpeech,
    configureTts,
    selectMicrophone: vi.fn(),
  }
  const unprepared: SpeechReadiness = {
    catalog: { ...speechCatalog, providers: [{ ...speechCatalog.providers[0]!, preparation: { phase: 'unprepared' } }] },
    connected: true,
    error: null,
  }
  const view = render(<VoiceConfigCard {...props} />)
  expect(view.queryByRole('button', { name: 'prepare' })).toBeNull()

  view.rerender(<VoiceConfigCard {...props} useSpeechReadiness={selectorHook(createSnapshotStore(unprepared))} />)
  fireEvent.click(view.getByRole('button', { name: 'prepare' }))
  expect(prepareSpeech).toHaveBeenCalledWith('sensevoice-local')

  act(() => { view.rerender(<VoiceConfigCard {...props} />) })
  fireEvent.change(view.getAllByRole('combobox')[1]!, { target: { value: 'en' } })
  expect(configureSpeech).toHaveBeenCalledWith({ language: 'en' })
})
