/** Both Remotes, dictionaries and per-Session voice loops follow plugin disposal. */
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { MutableSessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import { RemoteError, type TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { SynthesisProviderId } from '@deepseek-ai/dsh-experimental-text-to-speech/types'
import { describe, expect, it, vi } from 'vitest'
import { mountVoiceConversation, inject } from '../src/client/mount.ts'
import { apply as hostApply } from '../src/index.ts'
import { VoiceConversation } from '../src/client/VoiceConversation.tsx'
import { VoiceConfigCard } from '../src/client/PreparationCard.tsx'
import { VoiceSetupPrompt } from '../src/client/VoiceSetupPrompt.tsx'
import type { VoiceConfigInjected } from '../src/client/PreparationCard.tsx'
import type { VoiceConversationInjected } from '../src/client/VoiceConversation.tsx'

function assertActivity(value: Record<string, unknown>): asserts value is Record<string, unknown> & VoiceConversationInjected {
  for (const name of ['start', 'stop', 'release', 'getAmplitude', 'openSettings', 'selectMicrophone']) {
    assert(typeof value[name] === 'function')
  }
  assert(typeof value.hooks === 'object' && value.hooks !== null)
}

function assertConfig(value: Record<string, unknown>): asserts value is Record<string, unknown> & VoiceConfigInjected {
  for (const name of ['configureSpeech', 'configureTts', 'prepareSpeech', 'prepareTts',
    'cancelSpeechPreparation', 'cancelTtsPreparation', 'selectMicrophone']) {
    assert(typeof value[name] === 'function')
  }
}

const SPEECH_REMOTE: TypertRemoteContribution = {
  package: '@deepseek-ai/dsh-experimental-api-speech-to-text',
  descriptors: [],
}
const TTS_REMOTE: TypertRemoteContribution = {
  package: '@deepseek-ai/dsh-experimental-api-text-to-speech',
  descriptors: [],
}

const speechCatalog = {
  providers: [{
    id: 'sensevoice-local' as SpeechProviderId,
    name: 'SenseVoice',
    location: 'host-local' as const,
    languages: ['auto', 'zh', 'en'],
    preparation: { phase: 'ready' as const },
  }],
  selection: { providerId: 'sensevoice-local' as SpeechProviderId, language: 'auto' },
  maxAudioBytes: 5_000_000,
  maxDurationSeconds: 30,
}
const ttsCatalog = {
  providers: [{
    id: 'kokoro-local' as SynthesisProviderId,
    name: 'Kokoro',
    location: 'host-local' as const,
    voices: [{ id: 'zf_xiaobei', name: 'Xiaobei', languages: ['auto', 'zh', 'en'] }],
    preparation: { phase: 'ready' as const },
  }],
  selection: { providerId: 'kokoro-local' as SynthesisProviderId, voiceId: 'zf_xiaobei', language: 'auto' },
  maxTextChars: 500,
  maxAudioBytes: 16_000_000,
}

vi.mock('../src/client/readiness.ts', () => ({
  observeCatalog: (name: string) => name === 'speech.catalog'
    ? { state: createSnapshotStore({ catalog: speechCatalog, connected: true, error: null }), dispose: async () => undefined }
    : { state: createSnapshotStore({ catalog: ttsCatalog, connected: true, error: null }), dispose: async () => undefined },
}))

async function fixture() {
  const ctx = new Context()
  const unmounts = [vi.fn(async () => undefined), vi.fn(async () => undefined)]
  class Remote extends Service {
    constructor() { super(ctx, 'remote') }
    async $mount(contribution: TypertRemoteContribution) {
      return contribution === SPEECH_REMOTE ? unmounts[0]! : unmounts[1]!
    }
  }
  new Remote()
  ctx.provide('pluginNavigation', { openBundle: vi.fn() })
  const speech = {
    configure: vi.fn(async () => ({ ok: true as const, value: undefined })),
    prepare: vi.fn(async () => ({ ok: true as const, value: undefined })),
    cancelPreparation: vi.fn(async () => ({ ok: true as const, value: undefined })),
    transcribe: vi.fn(async () => ({ ok: true as const, value: { text: '' } })),
  }
  const tts = {
    configure: vi.fn(async () => ({ ok: true as const, value: undefined })),
    prepare: vi.fn(async () => ({ ok: true as const, value: undefined })),
    cancelPreparation: vi.fn(async () => ({ ok: true as const, value: undefined })),
    synthesize: vi.fn(async () => ({ ok: true as const, value: {} })),
  }
  ctx.provide('remote.speech', speech)
  ctx.provide('remote.tts', tts)
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry)
  ctx.slots.register({ name: 'root', children: {
    'conversation.input.activity': { kind: 'single', scope: 'session' },
    'plugins.bundle.activation': { kind: 'keyed', scope: 'root' },
    'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
  } } as never, () => null)

  const conversation = { send: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) }
  const binding = {
    session: createSnapshotStore({ running: false }),
    eventSource: new MutableSessionEventSource(),
  }
  ctx.provide('sessions', {
    binding: () => binding,
    scope: () => ({ get: (name: string) => name === 'conversation' ? conversation : undefined }),
  })
  return { ctx, unmounts, speech, tts, conversation }
}

describe('mountVoiceConversation', () => {
  it('registers three localized slots and mounts both Remote contributions', async () => {
    hostApply()
    const b = await fixture()
    try {
      const fiber = b.ctx.plugin({ inject: [...inject], apply: ctx => mountVoiceConversation(ctx, SPEECH_REMOTE, TTS_REMOTE) })
      await fiber

      const entry = b.ctx.slots.entries('conversation.input.activity').find(item => item.component === VoiceConversation)
      expect(entry).toMatchObject({ locale: 'voice-conversation' })
      const actions: Record<string, unknown> = entry!.inject!('s1' as never)
      assertActivity(actions)
      expect(actions.hooks.voiceState.getSnapshot().phase).toBe('off')
      actions.selectMicrophone({ id: 'usb', label: 'USB mic' })
      expect(actions.hooks.microphoneDevice.getSnapshot()).toEqual({ id: 'usb', label: 'USB mic' })
      await actions.release()

      for (const slot of ['plugins.bundle.config', 'plugins.bundle.activation'] as const) {
        const item = b.ctx.slots.entries(slot).find(entry => entry.component === VoiceConfigCard || entry.component === VoiceSetupPrompt)
        expect(item?.locale).toBe('voice-conversation')
      }

      await fiber.dispose()
      expect(b.ctx.slots.entries('conversation.input.activity')).toHaveLength(0)
      expect(b.ctx.slots.entries('plugins.bundle.config')).toHaveLength(0)
      expect(b.ctx.slots.entries('plugins.bundle.activation')).toHaveLength(0)
      for (const unmount of b.unmounts) expect(unmount).toHaveBeenCalledTimes(unmount === b.unmounts[1] ? 1 : 0)
    } finally {
      await b.ctx.fiber.dispose()
    }
  })

  it('routes config actions to the speech and TTS Remotes and throws their failures', async () => {
    const b = await fixture()
    try {
      const fiber = b.ctx.plugin({ inject: [...inject], apply: ctx => mountVoiceConversation(ctx, SPEECH_REMOTE, TTS_REMOTE) })
      await fiber
      const config: Record<string, unknown> = b.ctx.slots.entries('plugins.bundle.config')
        .find(item => item.component === VoiceConfigCard)!.inject!()
      assertConfig(config)
      await config.configureSpeech({ language: 'zh' })
      expect(b.speech.configure).toHaveBeenLastCalledWith({ language: 'zh' })
      await config.prepareTts('kokoro-local' as SynthesisProviderId)
      expect(b.tts.prepare).toHaveBeenLastCalledWith('kokoro-local')
      await config.cancelSpeechPreparation('sensevoice-local' as SpeechProviderId)
      expect(b.speech.cancelPreparation).toHaveBeenLastCalledWith('sensevoice-local')

      const failure = { ok: false, error: new RemoteError('gateway/internal', 'offline', {}) }
      b.speech.configure.mockResolvedValueOnce(failure as never)
      await expect(config.configureSpeech({ language: 'en' })).rejects.toThrow('offline')
      await fiber.dispose()
    } finally {
      await b.ctx.fiber.dispose()
    }
  })
})
