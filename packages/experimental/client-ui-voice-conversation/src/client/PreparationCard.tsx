/** Bundle config card: recognizer and synthesizer selection plus preparation. */
import { useEffect, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SpeechPreparationState,
  SpeechProviderView,
  SpeechSelectionPatch,
} from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type {
  SynthesisProviderView,
  SynthesisSelectionPatch,
} from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import type { SpeechReadiness, TtsReadiness } from './readiness.ts'
import type { MicrophoneDevice } from './microphone-device.ts'
import type { VoiceConversationKey } from './locales.ts'
import { NS } from './locales.ts'
import css from './VoiceConversation.module.css'

/** Host operations shared by the bundle configuration card. */
export interface VoiceConfigInjected {
  readonly hooks: {
    readonly speechReadiness: HostObservable<SpeechReadiness>
    readonly ttsReadiness: HostObservable<TtsReadiness>
    readonly microphoneDevice: HostObservable<MicrophoneDevice>
  }
  configureSpeech(patch: SpeechSelectionPatch): Promise<void>
  configureTts(patch: SynthesisSelectionPatch): Promise<void>
  prepareSpeech(providerId: SpeechProviderView['id']): Promise<void>
  cancelSpeechPreparation(providerId: SpeechProviderView['id']): Promise<void>
  prepareTts(providerId: SynthesisProviderView['id']): Promise<void>
  cancelTtsPreparation(providerId: SynthesisProviderView['id']): Promise<void>
  selectMicrophone(device: MicrophoneDevice): void
}

export type VoiceConfigProps = PropsLocale<typeof NS> & InjectFace<VoiceConfigInjected>

const PREPARABLE = new Set(['unprepared', 'cancelled', 'failed'])
const CANCELLABLE = new Set(['downloading', 'checking'])

/** One selectable option; localized options carry a dictionary key, others a raw provider-owned label. */
interface FieldOption {
  readonly value: string
  readonly labelKey?: VoiceConversationKey
  readonly label?: string
}

/** One provider section in catalog-neutral terms. */
interface SectionModel {
  readonly titleKey: VoiceConversationKey
  readonly providerName: string
  readonly preparation: SpeechPreparationState
  readonly fields: ReadonlyArray<{
    readonly key: string
    readonly labelKey: VoiceConversationKey
    readonly value: string
    readonly options: readonly FieldOption[]
  }>
  onFieldChange(key: string, value: string): void
  prepare(): Promise<void>
  cancel(): Promise<void>
}

function tone(state: SpeechPreparationState): StateDotState {
  if (state.phase === 'ready' || state.phase === 'standby') return 'done'
  if (state.phase === 'failed') return 'error'
  if (state.phase === 'unprepared' || state.phase === 'cancelled') return 'idle'
  return 'ongoing'
}

function languageOption(code: string): FieldOption {
  return { value: code, labelKey: code === 'auto' || code === 'zh' || code === 'en' ? code : 'auto' }
}

function MicrophoneField({ t, useMicrophoneDevice, selectMicrophone }: VoiceConfigProps) {
  const selected = useMicrophoneDevice(value => value)
  const [devices, setDevices] = useState<readonly MediaDeviceInfo[]>([])
  useEffect(() => {
    let cancelled = false
    const isCancelled = (): boolean => cancelled
    const enumerate = (globalThis.navigator as {
      mediaDevices?: Pick<MediaDevices, 'enumerateDevices'>
    }).mediaDevices?.enumerateDevices
    enumerate?.().then((list) => {
      if (!isCancelled()) setDevices(list.filter(device => device.kind === 'audioinput'))
    }).catch(() => {
      // Labels are unavailable before microphone permission; the system-default option stays usable.
    })
    return () => { cancelled = true }
  }, [])
  return <label className={css.field}>
    {t('config.microphone')}
    <select value={selected.id}
      onChange={(event) => {
        const device = devices.find(item => item.deviceId === event.target.value)
        selectMicrophone({ id: event.target.value, label: device?.label ?? '' })
      }}>
      <option value="">{t('systemMicrophone')}</option>
      {devices.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>
        {device.label || t('unnamedMicrophone', { number: String(index + 1) })}
      </option>)}
    </select>
  </label>
}

function ProviderSection({ model, t }: { model: SectionModel } & PropsLocale<typeof NS>) {
  const state = model.preparation
  const phase = state.phase
  return <section className={css.section}>
    <h3 className={css.sectionTitle}>{t(model.titleKey)}</h3>
    <div className={css.controls}>
      {model.fields.map(field => <label key={field.key} className={css.field}>
        {t(field.labelKey)}
        <select value={field.value}
          onChange={(event) => { model.onFieldChange(field.key, event.target.value) }}>
          {field.options.map(option => <option key={option.value} value={option.value}>
            {option.labelKey !== undefined ? t(option.labelKey) : option.label}
          </option>)}
        </select>
      </label>)}
    </div>
    <div className={css.phaseLine}>
      <StateDot state={tone(state)} size={14} />
      <span>{t(`preparation.${phase}`, { name: model.providerName })}</span>
      {PREPARABLE.has(phase)
        && <Button
          size="sm"
          type="button"
          onClick={() => { void model.prepare() }}
        >{t('prepare')}</Button>}
      {CANCELLABLE.has(phase)
        && <Button
          size="sm"
          type="button"
          onClick={() => { void model.cancel() }}
        >{t('cancelPrepare')}</Button>}
    </div>
  </section>
}

/** Render both provider sections and the browser microphone preference. */
export function VoiceConfigCard(props: VoiceConfigProps) {
  const { t, useSpeechReadiness, useTtsReadiness,
    configureSpeech, configureTts, prepareSpeech, prepareTts,
    cancelSpeechPreparation, cancelTtsPreparation } = props
  const speech = useSpeechReadiness(value => value)
  const tts = useTtsReadiness(value => value)
  const speechCatalog = speech.catalog
  const speechProvider = speechCatalog?.providers.find(item => item.id === speechCatalog.selection.providerId)
  const ttsCatalog = tts.catalog
  const ttsProvider = ttsCatalog?.providers.find(item => item.id === ttsCatalog.selection.providerId)
  const ttsVoice = ttsProvider?.voices.find(item => item.id === ttsCatalog?.selection.voiceId) ?? ttsProvider?.voices[0]

  const sections: SectionModel[] = []
  if (speechCatalog === null || speechProvider === undefined || ttsCatalog === null || ttsProvider === undefined) {
    return <div className={css.section} data-voice-config>
      <h2 className={css.sectionTitle}>{t('config.title')}</h2>
      <span className={css.phaseLine}>{t('reconnecting')}</span>
    </div>
  }
  sections.push({
    titleKey: 'config.speech',
    providerName: speechProvider.name,
    preparation: speechProvider.preparation,
    fields: [
      {
        key: 'providerId', labelKey: 'provider', value: speechCatalog.selection.providerId,
        options: speechCatalog.providers.map(item => ({ value: item.id, label: item.name })),
      },
      {
        key: 'language', labelKey: 'language', value: speechCatalog.selection.language,
        options: speechProvider.languages.map(languageOption),
      },
    ],
    onFieldChange: (key, value) => {
      void configureSpeech(key === 'providerId'
        ? { providerId: value as SpeechProviderView['id'] }
        : { language: value })
    },
    prepare: () => prepareSpeech(speechProvider.id),
    cancel: () => cancelSpeechPreparation(speechProvider.id),
  })
  sections.push({
    titleKey: 'config.tts',
    providerName: ttsProvider.name,
    preparation: ttsProvider.preparation,
    fields: [
      {
        key: 'providerId', labelKey: 'provider', value: ttsCatalog.selection.providerId,
        options: ttsCatalog.providers.map(item => ({ value: item.id, label: item.name })),
      },
      {
        key: 'voiceId', labelKey: 'voice', value: ttsCatalog.selection.voiceId,
        options: ttsProvider.voices.map(item => ({ value: item.id, label: item.name })),
      },
      {
        key: 'language', labelKey: 'language', value: ttsCatalog.selection.language,
        options: (ttsVoice?.languages ?? []).map(languageOption),
      },
    ],
    onFieldChange: (key, value) => {
      const patch = key === 'providerId' ? { providerId: value as SynthesisProviderView['id'] }
        : key === 'voiceId' ? { voiceId: value }
          : { language: value }
      void configureTts(patch)
    },
    prepare: () => prepareTts(ttsProvider.id),
    cancel: () => cancelTtsPreparation(ttsProvider.id),
  })

  return <div className={css.section} data-voice-config>
    <h2 className={css.sectionTitle}>{t('config.title')}</h2>
    {sections.map(model => <ProviderSection key={model.titleKey} model={model} t={t} />)}
    <section className={css.section}>
      <MicrophoneField {...props} />
    </section>
  </div>
}
