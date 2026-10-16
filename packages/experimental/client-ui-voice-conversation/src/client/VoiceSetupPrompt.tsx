/** Activation guidance until both local voice models are prepared. */
import { useEffect } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { VoiceConfigInjected } from './PreparationCard.tsx'
import { NS } from './locales.ts'
import css from './VoiceConversation.module.css'

/** Registration shares for the bundle's activation guidance. */
export type VoiceSetupPromptProps = PropsRuntime<'plugins.bundle.activation'>
  & PropsLocale<typeof NS>
  & Pick<InjectFace<VoiceConfigInjected>, 'useSpeechReadiness' | 'useTtsReadiness'>

/**
 * Show installation guidance while a selected host-local provider is unprepared.
 * @param props - activation navigation and the shared Host readiness observers.
 * @returns a minimal dialog, or nothing once both services are usable.
 */
export function VoiceSetupPrompt({ useSpeechReadiness, useTtsReadiness, onDismiss, onOpenDetails, t }: VoiceSetupPromptProps) {
  const speech = useSpeechReadiness(value => value)
  const tts = useTtsReadiness(value => value)
  const speechProvider = speech.catalog?.providers.find(item => item.id === speech.catalog?.selection.providerId)
  const ttsProvider = tts.catalog?.providers.find(item => item.id === tts.catalog?.selection.providerId)
  const speechUnprepared = speech.connected && speechProvider?.location === 'host-local' && speechProvider.preparation.phase === 'unprepared'
  const ttsUnprepared = tts.connected && ttsProvider?.location === 'host-local' && ttsProvider.preparation.phase === 'unprepared'
  const needsSetup = speechUnprepared || ttsUnprepared
  useEffect(() => {
    if (speech.connected && tts.connected && !needsSetup) onDismiss()
  }, [speech.connected, tts.connected, needsSetup, onDismiss])
  if (!needsSetup) return null
  return <div className={css.dialog} role="dialog" aria-label={t('setupPrompt.title')}>
    <h2 className={css.dialogTitle}>{t('setupPrompt.title')}</h2>
    <p className={css.dialogBody}>{t('setupPrompt.body')}</p>
    <div className={css.dialogActions}>
      <Button size="sm" type="button" onClick={onDismiss}>{t('setupPrompt.later')}</Button>
      <Button size="sm" type="button" onClick={onOpenDetails}>{t('setupPrompt.open')}</Button>
    </div>
  </div>
}
