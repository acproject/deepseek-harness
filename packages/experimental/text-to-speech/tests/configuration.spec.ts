/** Speech synthesis preferences persisted through the profile's Loader and Settings services. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import TextToSpeech from '../src/index.ts'
import type { SynthesisProviderId, SynthesisVoice } from '../src/types.ts'

it('saves language, voice and provider preferences without remounting and restores them at restart', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-synthesis-configuration-')))
  let ctx: Awaited<ReturnType<typeof boot>> | undefined
  try {
    const dir = join(home, 'profiles', 'test')
    initProfile(dir, ['test-bundle'])
    const bundle = join(dir, 'node_modules', 'test-bundle')
    mkdirSync(bundle, { recursive: true })
    writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
    writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
    writeFileSync(join(bundle, 'cordis.patch.yml'), readFileSync(new URL('./fixtures/selection.patch.yml', import.meta.url)))
    writeFileSync(join(dir, 'cordis.yml'), '[]\n')
    const profile: ProfileContext = {
      name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
      installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
    }
    const start = () => boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (root) => {
      root.provide('profileContext', profile)
      Object.assign(root.loader.builtins, { editor: ConfigEditor, settings: Settings, tts: TextToSpeech })
    })
    ctx = await start()
    const tts = ctx.get('textToSpeech')!
    const voices: readonly SynthesisVoice[] = [{ id: 'zf_xiaobei', name: 'Xiaobei', languages: ['auto', 'zh', 'en'] }]
    for (const id of ['kokoro-local', 'another-provider']) tts.register({
      info: { id: id as SynthesisProviderId, name: id, location: 'host-local', voices },
      synthesize: async () => { throw new Error('Changing preferences must not synthesize speech') },
    })
    const entry = ctx.configEditor.entries().find(row => row.options.id === 'text-to-speech')!
    expect(entry.id).toBe('include:text-to-speech')
    const fiber = entry.fiber
    for (const language of ['auto', 'zh', 'en', 'zh']) {
      await tts.configure({ language })
      expect(tts.snapshot().selection).toEqual({ providerId: 'kokoro-local', voiceId: 'zf_xiaobei', language })
    }
    await tts.configure({ providerId: 'another-provider' as SynthesisProviderId })
    expect(tts.snapshot().selection).toEqual({ providerId: 'another-provider', voiceId: 'zf_xiaobei', language: 'zh' })
    expect(entry.fiber === fiber).toBe(true)
    const saved = readFileSync(profile.patchPath, 'utf8')
    expect(saved).toContain('id: text-to-speech')
    expect(saved).toContain('defaultProvider: another-provider')
    expect(saved).toContain('defaultVoice: zf_xiaobei')
    expect(saved).toContain('language: zh')
    await ctx.fiber.dispose()
    ctx = await start()
    expect(ctx.get('textToSpeech')!.snapshot().selection).toEqual({ providerId: 'another-provider', voiceId: 'zf_xiaobei', language: 'zh' })
  } finally {
    try { await ctx?.fiber.dispose() } finally { rmSync(home, { recursive: true, force: true }) }
  }
})
