# 语音对话

[English](voice-conversation.md) | 中文

实验性语音对话闭合语音链路：[合成服务定义](../../packages/experimental/text-to-speech/README.zh.md)路由具名语音合成 Provider，[Kokoro Provider](../../packages/experimental/text-to-speech-kokoro/README.zh.md)拥有本地合成，[macOS Provider](../../packages/experimental/text-to-speech-macos/README.zh.md)通过系统 `say` 命令朗读，[Remote 消费者](../../packages/experimental/api-text-to-speech/README.zh.md)服务浏览器。[浏览器闭环](../../packages/experimental/client-ui-voice-conversation/README.zh.md)将它们与既有[识别栈](../../packages/experimental/speech-to-text/README.zh.md)及其 [SenseVoice 识别器](../../packages/experimental/speech-to-text-sensevoice/README.zh.md)配对；[可选 Bundle](../../packages/experimental/voice-conversation-bundle/README.zh.md)组合全部八个插件。识别遵循[语音输入](voice-input.zh.md)契约；本页只覆盖合成与常开对话闭环。

## Provider 选择

`SynthesisProviderId` 为注册标识添加类型品牌。`SynthesisProviderInfo` 携带显示名称、`host-local` 或 `cloud` 处理位置及可选语音列表 `voices`；每个 `SynthesisVoice` 列出支持的 `languages` 语言提示，混语文本使用 `auto`。`SynthesisRequest` 包含文本和可选的 Provider、语音、语言选择；`resolve()` 生成捕获一个 Provider 实例的 `SynthesisSpec`。缺失的 Provider、语音或不支持的语言会报错；替换或撤销会使已解析的任务失效。语音不会回退到其他 Provider。

`SynthesisProvider.synthesize()` 接收一段由调用方限长的完整 `SynthesisInput` 与 `AbortSignal`。`SynthesisResult` 返回规范单声道 PCM16 WAV 字节，以及 `sampleRate`、`audioSeconds` 和 `synthesisSeconds`。Provider 响应取消，并在注销完成前结束其任务。本地 Provider 串行执行调用、限制队列，并独立于 Session 管理工作进程生命周期。

## 浏览器与 Host 所有权

浏览器拥有麦克风轨道、播放和全部交互时序；Host 拥有识别、合成与 Provider 资源。Remote 面是唯一边界：`TtsCatalog` 公布 Provider、语音、默认选择与合成限制，`SynthesisRequestWire` 携带限长文本和选择，`SynthesizedAudioWire` 返回 base64 WAV。API 在进程边界校验输入，并以类型化 Remote 错误报告 `tts/invalid-text` 或 `tts/synthesis-failed`。语句识别原样复用 `TranscriptionRequest`。

每个 Session 一个 controller 驱动闭环：常开采集重采样为 16 kHz 单声道（优先 AudioWorklet，回退 ScriptProcessor），保留预滚，带校准、起始和插话门限的能量 VAD 依据句尾静音切分语句。闭合语句用语音输入共享的 WAV 编码器编码，只转写一次，并作为普通用户消息提交。助手文本从 Session 事件流消费：基线之上的 append 型持久内容与瞬时增量被切分为完整句子加一个结算时尾部片段，每句话发起一次非流式合成请求，经按键 FIFO 队列播放。

回声防御分层。麦克风轨道请求浏览器的回声消除、降噪和自动增益；播放期间的起始能量必须显著更高并经短暂确认；归一化文本回声守卫丢弃与近期朗读内容相同的转写；新回合或 interrupted 结算会在插话发送前中止待执行合成、清空队列并停止播放。耳机检测将可信度降级为扬声器警告；开放环境仍有残余风险。音频帧和转写不写入 Session 事件；模型可见文字由普通提交消息拥有。

## 准备与设置

合成复用识别的准备词汇：`SynthesisPreparationState`、有序的 `SynthesisPreparationStep`、`SynthesisSetupEstimate`、`downloadSources` 和 `SynthesisDownloadFailure` 都是共享语音类型的别名。Kokoro Provider 在页面和 Session 变化期间拥有同一个准备任务，缓存根目录为独立的 `dshHomePath('text-to-speech', 'kokoro')`。Client 在活动入口、安装引导和 Bundle 详情之间共享一份识别与一份合成 `follow()` 订阅；载波失败只把镜像标记为断连，不改写最后一份目录。

常开活动入口占用 `conversation.input.activity`，与按键说话的语音输入共享该槽；Bundle 只挂载一个客户端贡献。Bundle 详情占用以 Bundle id 为键的 `plugins.bundle.config` 和 `plugins.bundle.activation`，包含 Provider、语音、语言和麦克风偏好，以及准备状态和进度。所选麦克风保存在独立于语音输入插件的浏览器本地键中。Bundle 补丁在 darwin 上默认 `macos-say` Provider、语音 `Tingting (中文（中国大陆）)`，其他平台默认 `kokoro-local` Provider、语音 `zf_xiaobei`，语言均为 `auto`；识别默认为 `sensevoice-local`。

## 设计依据

[语音对话决策](../../.agents/notes/implemented/architecture/2026-10-15-experimental-voice-conversation.zh.md)记录 Kokoro 选型、非流式按句管线、五层回声防御，以及复用识别接缝而非新增第二条 ASR 路径的决策。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtexttospeech--texttospeech"></a>

### `ctx.textToSpeech` — `TextToSpeech`

Registry shared by all synthesis consumers in one Host composition.

```ts cordis-catalog
/**
 * Register one synthesizer; duplicate ids fail without replacing the original.
 * @param provider - synthesizer owned by the contributing fiber.
 * @returns idempotent disposer which rejects admission, cancels, and joins accepted work.
 */
register(provider: SynthesisProvider): () => Promise<void>

/**
 * Read the current synthesizer roster.
 * @returns available provider facts in registration order.
 */
listProviders(): readonly SynthesisProvider['info'][]

/**
 * Observe complete readiness snapshots; a slow reader coalesces intermediate progress.
 * @param caller - observer lifetime, independent of any preparation task.
 * @returns an initial snapshot followed by the latest provider states.
 */
async *follow(caller: AbortSignal): AsyncIterable<SynthesisSnapshot>

/**
 * Read provider readiness and current user preferences together.
 * @returns one detached complete observation.
 */
snapshot(): SynthesisSnapshot

/**
 * Persist changed selection fields into this plugin's profile entry; the resulting voice and language must be
 * accepted by the selected provider.
 * @param patch - explicit provider, voice or language changes.
 * @returns after the profile write and the live update it applies.
 */
async configure(patch: SynthesisSelectionPatch): Promise<void>

/**
 * Start or join provider-owned preparation.
 * @param id - exact registered provider identity.
 * @param options - task-local source selection validated by the provider.
 */
prepare(id: SynthesisProviderId, options?: SynthesisPreparationOptions): void

/**
 * Explicitly cancel provider preparation without tying it to a browser connection.
 * @param id - exact registered provider identity.
 * @returns after the preparation task settles.
 */
async cancelPreparation(id: SynthesisProviderId): Promise<void>

/**
 * Apply composition defaults and capture the selected provider. Missing providers, voices and unsupported
 * languages fail explicitly.
 * @param request - complete text and optional selection.
 * @returns provider-pinned input for synthesize().
 */
resolve(request: SynthesisRequest): SynthesisSpec

/**
 * Execute exactly the resolved provider; no fallback sends text elsewhere.
 * @param spec - resolved input; a withdrawn or replaced registration is rejected.
 * @param signal - caller cancellation.
 * @returns final audio after provider settlement.
 */
async synthesize(spec: SynthesisSpec, signal: AbortSignal): Promise<SynthesisResult>
```

Source: [`packages/experimental/text-to-speech/src/index.ts`](../../packages/experimental/text-to-speech/src/index.ts)

<a id="ctxttscontroller--ttscontroller"></a>

### `ctx.ttsController` — `TtsController`

Synthesis calls never activate or submit to an Agent.

```ts cordis-catalog
/**
 * Read provider choices without preparing a synthesizer.
 * @returns available providers, resolved default, and intake limits.
 */
@Remote catalog(): TtsCatalog

/**
 * Follow provider readiness independently of Session and preparation lifetimes.
 * @param signal - Client observation lifetime.
 * @returns initial and subsequent complete readiness snapshots.
 */
@Remote({ mode: 'stream' }) async *follow(signal: AbortSignal): AsyncIterable<TtsCatalog>

/**
 * Persist the user's synthesis preferences.
 * @param patch - changed preference fields.
 * @returns after preferences are saved.
 */
@Remote configure(patch: SynthesisSelectionPatch): Promise<void>

/**
 * Start or join one Host-owned preparation task.
 * @param providerId - selected synthesizer.
 * @param options - task-local source selection validated by the provider.
 */
@Remote prepare(providerId: SynthesisProviderId, options?: SynthesisPreparationOptions): void

/**
 * Explicitly cancel resource preparation.
 * @param providerId - selected synthesizer.
 * @returns after the preparation task settles.
 */
@Remote cancelPreparation(providerId: SynthesisProviderId): Promise<void>

/**
 * Validate and synthesize one text through the explicit provider selection.
 * @param request - text, provider id, voice id and language hint.
 * @param signal - Client cancellation or Remote contribution disposal.
 * @returns canonical WAV encoded as base64, without adding a Session event.
 */
@Remote async synthesize(request: SynthesisRequestWire, signal: AbortSignal): Promise<SynthesizedAudioWire>
```

Source: [`packages/experimental/api-text-to-speech/src/index.ts`](../../packages/experimental/api-text-to-speech/src/index.ts)
<!-- END GENERATED cordis-surface -->
