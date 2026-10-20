/** Source-safe lifecycle for the speech + TTS Remotes and the always-on UI. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-experimental-api-speech-to-text/remote'
import type {} from '@deepseek-ai/dsh-experimental-api-text-to-speech/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ISessions, SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SpeechCatalog } from '@deepseek-ai/dsh-experimental-api-speech-to-text/types'
import type {
  SynthesisRequestWire,
  TtsCatalog,
} from '@deepseek-ai/dsh-experimental-api-text-to-speech/types'
import { VoiceController } from './controller.ts'
import { AssistantSpeakAction } from './AssistantSpeakAction.tsx'
import { VoiceConversation, type VoiceConversationInjected } from './VoiceConversation.tsx'
import { VoiceConfigCard, type VoiceConfigInjected } from './PreparationCard.tsx'
import { VoiceSetupPrompt } from './VoiceSetupPrompt.tsx'
import { createMicrophoneDeviceStore } from './microphone-device.ts'
import { en, NS, zh } from './locales.ts'
import { observeCatalog, type SpeechReadiness, type TtsReadiness } from './readiness.ts'

/**
 * Base Client services needed before this plugin activates.
 * `remote.speech` arrives from the voice-input bundle; this bundle only owns
 * the `tts` namespace, so `remote.tts` is deliberately absent here — it
 * becomes available below via `ctx.remote.$mount(ttsContribution)`.
 */
export const inject = ['remote', 'remote.speech', 'slots', 'locale', 'sessions', 'pluginNavigation']

/** The only namespace voice-conversation mounts itself. */
const uiInject = ['remote.tts']

/** Resolve or create the one voice loop bound to one Session. */
function controllerFor(
  sessions: ISessions,
  sessionId: Parameters<ISessions['binding']>[0],
  controllers: WeakMap<SessionBinding, VoiceController>,
  ctx: Context,
  speechState: SnapshotStore<SpeechReadiness>,
  ttsState: SnapshotStore<TtsReadiness>,
): { binding: SessionBinding; controller: VoiceController } {
  const binding = sessions.binding(sessionId)
  if (binding === undefined) throw new Error(`voice-conversation: session "${String(sessionId)}" has no binding`)
  const existing = controllers.get(binding)
  if (existing !== undefined) return { binding, controller: existing }
  const scoped = sessions.scope(sessionId)
  if (scoped === undefined) throw new Error(`voice-conversation: session "${String(sessionId)}" resolved no scope`)
  const conversation = scoped.get('conversation')
  if (conversation === undefined) {
    throw new Error('voice-conversation: conversation service unavailable through the session scope')
  }
  const controller = new VoiceController({
    speech: speechState,
    tts: ttsState,
    send: text => conversation.send(text),
    cancel: () => conversation.cancel(),
    subscribeSession: listener => binding.session.subscribe(listener),
    sessionRunning: () => binding.session.getSnapshot().running,
    subscribeEvents: listener => binding.eventSource.subscribe(listener),
    eventWindow: () => binding.eventSource.getSnapshot(),
    transcribe: (request, signal) => ctx.remote.speech.transcribe(request, signal),
    synthesize: (request, signal) => ctx.remote.tts.synthesize(request, signal),
  })
  controllers.set(binding, controller)
  return { binding, controller }
}

function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  const microphone = createMicrophoneDeviceStore()
  const speech = observeCatalog<SpeechCatalog>(ctx, 'speech.catalog', signal => ctx.remote.speech.follow(signal))
  const tts = observeCatalog<TtsCatalog>(ctx, 'tts.catalog', signal => ctx.remote.tts.follow(signal))
  ctx.effect(() => speech.dispose)
  ctx.effect(() => tts.dispose)
  const sessions = ctx.get('sessions') as ISessions
  const controllers = new WeakMap<SessionBinding, VoiceController>()

  const config: VoiceConfigInjected = {
    hooks: {
      speechReadiness: speech.state,
      ttsReadiness: tts.state,
      microphoneDevice: microphone,
    },
    configureSpeech: async (patch) => {
      const result = await ctx.remote.speech.configure(patch)
      if (!result.ok) throw result.error
    },
    configureTts: async (patch) => {
      const result = await ctx.remote.tts.configure(patch)
      if (!result.ok) throw result.error
    },
    prepareSpeech: async (providerId) => {
      const result = await ctx.remote.speech.prepare(providerId)
      if (!result.ok) throw result.error
    },
    cancelSpeechPreparation: async (providerId) => {
      const result = await ctx.remote.speech.cancelPreparation(providerId)
      if (!result.ok) throw result.error
    },
    prepareTts: async (providerId) => {
      const result = await ctx.remote.tts.prepare(providerId)
      if (!result.ok) throw result.error
    },
    cancelTtsPreparation: async (providerId) => {
      const result = await ctx.remote.tts.cancelPreparation(providerId)
      if (!result.ok) throw result.error
    },
    selectMicrophone: (device) => { microphone.set(device) },
  }

  // Shadow voice-input's mic-button UI with the full always-on conversation loop.
  ctx.slots.inject('conversation.input.activity', () => ctx.slots.register({
    name: 'conversation.input.activity',
    priority: -1,
    locale: NS,
    inject: (sessionId): VoiceConversationInjected => {
      const { binding, controller } = controllerFor(sessions, sessionId, controllers, ctx, speech.state, tts.state)
      return {
        hooks: {
          speechReadiness: speech.state,
          ttsReadiness: tts.state,
          voiceState: controller.state,
          microphoneDevice: microphone,
        },
        openSettings: () => { ctx.pluginNavigation.openBundle('@deepseek-ai/dsh-experimental-voice-conversation-bundle') },
        start: deviceId => controller.start(deviceId),
        stop: () => controller.stop(),
        setMuted: (muted) => { controller.setMuted(muted) },
        release: async () => {
          await controller.dispose()
          controllers.delete(binding)
        },
        getAmplitude: () => controller.amplitude(),
        selectMicrophone: (device) => { microphone.set(device) },
      }
    },
  }, VoiceConversation))

  // Manual replay entry beside copy in every finalized assistant reply.
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'speak',
    order: 20,
    locale: NS,
    inject: () => ({
      hooks: { ttsReadiness: tts.state },
      synthesize: (request: SynthesisRequestWire, signal: AbortSignal) => ctx.remote.tts.synthesize(request, signal),
    }),
  }, AssistantSpeakAction))

  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: '@deepseek-ai/dsh-experimental-voice-conversation-bundle',
    locale: NS,
    inject: () => config,
  }, VoiceConfigCard))

  ctx.slots.inject('plugins.bundle.activation', () => ctx.slots.register({
    name: 'plugins.bundle.activation',
    key: '@deepseek-ai/dsh-experimental-voice-conversation-bundle',
    locale: NS,
    inject: () => config,
  }, VoiceSetupPrompt))
}

/**
 * Mount both experimental namespaces without adding them to stable API Remotes.
 * @param ctx - Client runtime owning the Remotes, dictionaries and slots.
 * @param speechContribution - generated speech Remote definitions.
 * @param ttsContribution - generated synthesis Remote definitions.
 * @returns disposer joining UI and both Remote withdrawals.
 */
export async function mountVoiceConversation(
  ctx: Context,
  _speechContribution: TypertRemoteContribution,
  ttsContribution: TypertRemoteContribution,
): Promise<() => Promise<void>> {
  // speech namespace is owned by voice-input bundle; top-level inject
  // ['remote.speech', ...] guarantees it is mounted before we activate.
  const disposeTts = await ctx.remote.$mount(ttsContribution)
  const ui = ctx.inject([...inject, ...uiInject], registerUi)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeTts()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeTts()
  }
}
