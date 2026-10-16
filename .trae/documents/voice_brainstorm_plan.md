# Voice Brainstorm 第一步：本地 TTS 能力缝 + 全双工语音问答闭环

## 决策边界（已与用户确认）

- 本期范围：仅桌面/Web 的**语音问答闭环**。不做：本地 Qwen LLM adapter、Mobile Companion PWA/WebRTC、Brainstorm Service（Idea Graph、Diverge/Critic/Converge）。这些在包文档 Known Limitations 中显式列为后续阶段。
- ASR：**零重写**，直接复用现有 `speech-to-text`（注册表）+ `speech-to-text-sensevoice`（sherpa-onnx 本地推理）+ `api-speech-to-text`（Remote）。
- TTS：首发 **Kokoro 多语言**（sherpa-onnx `kokoro-multi-lang-v1_0`，中英日韩等），沿用 SenseVoice 的「managed 子进程 + 首次下载 sha256 锁定资产 + preparation 状态机」模式。
- 交互：**全双工常开监听**（always-on mic、本地断句、自由打断 barge-in）。

## Repository Research（已勘察事实）

- ASR 能力缝已完整：
  - 服务定义 [speech-to-text/src/index.ts](file:///Users/acproject/workspace/node_projects/deepseek-harness/packages/experimental/speech-to-text/src/index.ts)：`SpeechToText` Service，provider 注册/注销（注销 join 所有在途任务）、volatile 选择持久化（settings profile entry）、`resolve()` 显式捕获 provider、无 fallback。
  - 类型契约 [speech-to-text/src/types.ts](file:///Users/acproject/workspace/node_projects/deepseek-harness/packages/experimental/speech-to-text/src/types.ts)：`SpeechProviderInfo / SpeechPreparation / SpeechInput / Transcript / SpeechProvider`。
  - 本地 provider [speech-to-text-sensevoice](file:///Users/acproject/workspace/node_projects/deepseek-harness/packages/experimental/speech-to-text-sensevoice)：`sherpa-onnx-node@1.13.8`（CJS Node-API，在独立子进程中 `createRequire` 加载）；[recognizer.ts](file:///Users/acproject/workspace/node_projects/deepseek-harness/packages/experimental/speech-to-text-sensevoice/src/recognizer.ts) 是串行队列 + 空闲回收 + readiness 帧 + loopback HTTP bearer token 的 worker 管理器；[runtime.ts](file:///Users/acproject/workspace/node_projects/deepseek-harness/packages/experimental/speech-to-text-sensevoice/src/runtime.ts) 负责 sha256/字节数锁定资产、断点临时文件、原子 rename、镜像源探测；[assets.json](file:///Users/acproject/workspace/node_projects/deepseek-harness/packages/experimental/speech-to-text-sensevoice/runtime/assets.json) 锁定 HF revision。
  - Remote [api-speech-to-text/src/index.ts](file:///Users/acproject/workspace/node_projects/deepseek-harness/packages/experimental/api-speech-to-text/src/index.ts)：`TypertRemoteService`，namespace `speech`，`catalog/follow/configure/prepare/cancelPreparation/transcribe`，WAV base64 + 字节/时长校验。
  - 客户端 [client-ui-voice-input](file:///Users/acproject/workspace/node_projects/deepseek-harness/packages/experimental/client-ui-voice-input)：槽位 `conversation.input.activity`、`plugins.bundle.config`、`plugins.bundle.activation`；`audio.ts` 提供 16kHz PCM16 WAV 编码、getUserMedia（已开 echoCancellation/noiseSuppression）。
  - bundle [voice-input-bundle/cordis.patch.yml](file:///Users/acproject/workspace/node_projects/deepseek-harness/packages/experimental/voice-input-bundle/cordis.patch.yml) 通过 `dsh.bundle.patch` 组合四个插件。
- `sherpa-onnx-node@1.13.8` 已随仓库安装，含 `non-streaming-tts.js`（OfflineTts，支持 Kokoro/VITS/Matcha），无需新原生依赖。
- 仓库当前**没有任何 TTS**。
- 客户端会话能力（[ui-conversation/service.ts](file:///Users/acproject/workspace/node_projects/deepseek-harness/packages/client/ui-conversation/src/client/service.ts) 与 [api/session-controller](file:///Users/acproject/workspace/node_projects/deepseek-harness/packages/api/session-controller)）：
  - 提交：`session.prompt([{ type: 'text', text }], 'queue')`（Host 契约 `SessionPromptRequest`）。
  - 观察：`remote.session.follow(sessionId, { assistantStream: true })` 接收 assistant 增量。
  - 取消：turn cancel（`SessionCancelRequest`，对应 `IConversation.cancel()`）。
  - 跨插件持活：`sessions.retain()/using()`。
  - 因此**语音 FSM 放在客户端插件内即可闭环，不改 agent-loop、不新增 Session 事件**；最终上屏文本走普通用户消息路径（符合 "Recognition itself writes no Session event"）。
- 实验包隔离规则：release 包不得依赖 experimental 包；experimental 包可依赖 release 包与彼此。新插件全部落在 `packages/experimental/`，公开发布（非 PRIVATE 列表），命名遵循 experimental 命名策略。

## 架构映射

```
浏览器（新 client-ui-voice-conversation 插件，FSM 属主）
  麦克风(16k AudioWorklet, RMS/VAD 断句 + 播放期回声门限)
    └─ WAV ── remote.speech.transcribe（复用，SenseVoice 内还有 Silero 二次校验）
         └─ 最终文本 ── session.prompt('queue')        （普通用户消息）
                              ↓ agent turn
              session.follow({assistantStream:true}) ── 增量文本
                   └─ 中英分句/限长 ── remote.tts.synthesize（每句一次，可预取一句）
                         └─ 24kHz PCM16 WAV ── AudioBuffer 队列无缝播放
  barge-in：停止播放 + abort 在途合成 +（若 turn 在跑）session cancel → 再提交新话语

Host（新能力缝，镜像 ASR 三件套）
  text-to-speech（Service 定义/注册/选择持久化）
    └ text-to-speech-kokoro（provider：子进程 OfflineTts + 锁定资产）
  api-text-to-speech（Remote: tts.catalog/follow/configure/prepare/.../synthesize）
```

## Files and Modules

### 新增包

1. `packages/experimental/text-to-speech/`（**Service Definition**，镜像 speech-to-text）
   - `src/types.ts`（仅类型）：`SynthesisProviderId`（branded）、`SynthesisVoice { id, name, languages }`、`SynthesisProviderInfo`（id/name/location/voices/setupEstimate/downloadSources）、preparation 系列类型**直接复用** speech-to-text 的 `SpeechPreparationState/Step/...`（从该包类型导入，不复制）、`SynthesisSelection { providerId, voiceId }`、`SynthesisInput { text, voiceId, language }`、`SynthesisResult { audio: Uint8Array; mimeType: 'audio/wav'; sampleRate; synthesisSeconds; audioSeconds }`、`SynthesisProvider { info; preparation?; synthesize(input, signal) }`、`SynthesisRequest/SynthesisSpec`。
   - `src/index.ts`：`TextToTextToSpeech`→`TextToSpeech extends Service`（`ctx.textToText`→`ctx.textToSpeech`）：`register/listProviders/follow/snapshot/configure（providerId+voiceId，校验 voice 属于 provider）/prepare/cancelPreparation/resolve/synthesize`；Config：`defaultProvider`、`defaultVoice` volatile；注销语义、queue 上限、无 fallback 全部对齐 ASR。
   - `locale/{en,zh}.json`、双语 README + `README.i18n.yaml`（Known Limitations：仅离线 TTS、单句长度上限）、package.json/tsconfig/tsdown（照抄 speech-to-text 的依赖与 exports 形态）。
2. `packages/experimental/text-to-speech-kokoro/`（**Provider**，镜像 speech-to-text-sensevoice 文件结构）
   - `src/config.ts`：schemastery 校验。字段：`providerId`（默认 `kokoro-local`）、`dataRoot`（必填绝对路径）、`modelDirectory/dataDirectory/dictDirectory`（手动资产覆盖，全绝对路径）、`precision: 'int8'|'fp32'`（默认 int8）、`defaultVoice`（默认 `zf_xiaobei`，加载时校验存在）、`modelOrigins/modelOrigin/modelProbeTimeoutMs`（默认 `huggingface.co` + `hf-mirror.com`）、`threads`、`speed`、`maxTextChars`、`maxAudioBytes`、`prepareTimeoutMs/synthesisTimeoutMs/idleTimeoutMs/maxPending/graceMs/maxLogBytes/maxResponseBytes/progressIntervalMs`。
   - `runtime/assets.json`：锁定 `model.int8.onnx`/`model.onnx`、`tokens.txt`、`voices.bin`、`espeak-ng-data.tar.bz2`（归档）、`dict/` 内逐个文件（jieba 词典/多音字）。条目含 name/url(HF 固定 revision)/bytes/sha256；归档条目额外记录解压后清单哈希与 stamp 文件名。
   - `src/runtime.ts`：复用 ASR 的单文件下载/校验/原子发布逻辑（同模式新写，禁止跨包偷拷内部模块；如抽出共享须另建 release util 包，本期不做）；新增 `extractArchive()`：通过 `ctx.subprocess.spawn` 调系统 `tar`（macOS/Linux GNU tar、Windows `System32\tar.exe` 均内置 bzip2/libarchive）解压到 provider dataRoot，成功后写 `.verified` stamp（含归档 sha256）；失败 loud 报准备错误。
   - `src/voices.ts`：`voices.json`（voice 名 → sid/语言/性别，按 k2-fsa 发布清单）+ 加载时与 `tts.numSpeakers` 校验；不一致则准备失败。
   - `src/inference.ts`：子进程内 `createRequire('sherpa-onnx-node').OfflineTts`，Kokoro 配置（model/voices/tokens/dataDir=espeak-ng-data/dictDir=jieba/threads/provider cpu）；`generate(text, sid, speed)` 返回 Float32 24kHz → 编码 PCM16 WAV（worker 侧编码，输出含 mimeType/sampleRate）。Electron V8 cage 下复制 native buffer。
   - `src/process-server.ts`：loopback HTTP（`/synthesize` POST JSON {text,voiceId}，bearer token，动态端口，就绪帧），仿 ASR process-server。
   - `src/worker.ts`：子进程入口（argv 配置 + `DSH_TTS_TOKEN`，读完即删环境变量）。
   - `src/recognizer.ts` 对应物 `src/synth-worker.ts`：串行队列、空闲回收、preparation 状态机（步骤 check/model(含归档)/verify/load）、downloadSources 暴露。
   - `src/index.ts`：function plugin（`name/inject=['textToSpeech','subprocess']/Config/apply`），注册 provider；activation 只 inspect 不下载不加载。
   - `src/download-error.ts`：同 ASR 分类（复用模式）。
   - 测试：runtime 下载/校验/stamp、归档解压（fixture tar）、worker 协议、队列/取消/空闲、provider 注册契约（fixture worker）、`local.e2e.ts`（无模型自跳过）、voices 校验。
3. `packages/experimental/api-text-to-speech/`（**Remote Consumer**）
   - `src/index.ts`：`TtsController extends TypertRemoteService`，namespace `tts`，`ctx.ttsController`；方法 `catalog / follow(stream) / configure / prepare / cancelPreparation / synthesize`。
   - `src/types.ts`：`SynthesisRequestWire { text; providerId?; voiceId?; language? }`、`SynthesisCatalog`（snapshot + 限制）、`SynthesizedAudioWire { audioBase64; mimeType; sampleRate; synthesisSeconds; audioSeconds }`。
   - 边界校验（parser/wire 边界）：文本 Unicode 码点长度 ≤ `maxTextChars`、合成字节 ≤ `maxAudioBytes`、空文本拒绝；错误映射 `tts/invalid-text`、`tts/synthesis-failed` RemoteError。
   - `tests/controller.spec.ts`、wave 限制用例；双语 README/locales。
4. `packages/experimental/client-ui-voice-conversation/`（**客户端 FSM + UI**，platform web）
   - `src/client/audio/worklet.ts`（AudioWorkletProcessor 单文件，tsdown worker 入口）：16kHz 帧 RMS；主线程拥有状态，worklet 只出 PCM 帧与电平。
   - `src/client/audio/capture.ts`：`AlwaysOnCapture`：`AudioContext({sampleRate:16000})`，不支持则原生采样率 + worklet 内降采样；getUserMedia 强制 `echoCancellation/noiseSuppression/autoGain`；噪声底自适应标定；断句参数（起音帧数、静音帧数、最短语音）来自客户端配置常量但不写死部署值（沿用插件 Config 注入）；页面隐藏/unmount 必释放 track；输出段 PCM。
   - `src/client/audio/echo-gate.ts`：播放期自适应门限（mic RMS vs TTS 参考电平 + 余量）；耳机检测（enumerateDevices + devicechange），扬声器输出时抬升门限并在 UI 告警。
   - `src/client/audio/wav.ts`：**不复制**，从 `@deepseek-ai/dsh-experimental-client-ui-voice-input/audio` 子路径导入 `encodeWave/audioBase64/RecordingError`（见第 5 项改动）。
   - `src/client/playback.ts`：WAV 帧 `decodeAudioData` → AudioBuffer 队列，按 AudioContext 时间轴顺序调度（保持 1 句预取在途）；`cancel()` 立即停全部源；记录已播放文本（供回声守卫）。
   - `src/client/segment.ts`：中英日韩分句 + 最大码点切分（不破坏代理对/字符簇），剥除代码围栏/Markdown 噪声的最小规则；空句跳过。
   - `src/client/fsm.ts`：状态机 `inactive | listening | utterance | transcribing | thinking | speaking`（speaking 与 listening 并行）。动作：段成音→transcribe→空文本丢弃→回声守卫（归一化后若为最近播放文本的子串则丢弃）→`session.prompt('queue')`；follow assistantStream→分句→顺序 synthesize（abort 信号随会话）→入播放队列；barge-in（播放/思考中检测到合格话语）→`playback.cancel()`+abort 合成+(turn 在跑则)`session.cancel()`→新话语走正常提交；Session 切换/插件卸载即作废在途结果（仿 voice-input revision 机制）。
   - `src/client/VoiceConversation.tsx`：`conversation.input.activity` 槽位贡献（模式开关 + 常驻录音指示/电平 + 状态 chip：listening/thinking/speaking + 扬声器告警 + 停止）；`plugins.bundle.config` 与 `plugins.bundle.activation` 贡献（同一卡内同时呈现 ASR 与 TTS 的 provider/voice 选择、准备进度，跨页共享一个 follow 订阅）。
   - `src/client/mount.ts`/`index.ts`：`$mount` tts remote contribution；inject：remote、slots、locale、session-controller、sessions retain、speech remote、ui-conversation 类型面。
   - locale 全部走 typed dictionaries（`t`），禁止硬编码英文/中文案；双语 locale JSON。
   - 测试（client spec）：FSM 转换矩阵（含 barge-in、cancel 后提交顺序、Session 切换作废、回声子串守卫、空转写丢弃）、断句、播放队列/取消、门限抬升、mount 组合测试、worklet 帧处理（fixture）。
5. `packages/experimental/voice-conversation-bundle/`
   - `cordis.patch.yml` insert：`speech-to-text`（defaultProvider: sensevoice-local）、`speech-to-text-sensevoice`（dataRoot `dshHomePath('speech-to-text','sensevoice')`）、`api-speech-to-text`、`text-to-speech`（defaultProvider: kokoro-local, defaultVoice）、`text-to-speech-kokoro`（dataRoot `dshHomePath('text-to-speech','kokoro')`）、`api-text-to-speech`、`ui-voice-conversation`。**不挂** `ui-voice-input`（避免 composer 出现两个麦克风控件；其音频编码工具以库方式被引用）。
   - `package.json`（`dsh.bundle.patch`、deps 即 manifest dependencies，满足 verify-cordis-config）、`icon.svg`（走 dsh-official-plugin-artwork，需设计师批准；未批准前不提交新 glyph）、locale、双语 README。

### 修改的既有文件

- `packages/experimental/client-ui-voice-input/`：新增**纯追加**子路径导出 `"./audio"`（package.json exports + tsdown 多入口 + 客户端类型面），导出 `encodeWave/audioBase64/RecordingError`；不改现有行为。
- 实验包聚合：experimental 组的 tsconfig project references 聚合文件加入 4 个新包；若有包清单/家族脚本（release families、experimental/package policy 清单）按其失败提示登记。
- `docs/subsystems/`：新增 `voice-conversation.md` + `voice-conversation.zh.md`（类型语义 + 生成的 cordis-surface；ttsController 与 textToSpeech 两块）；subsystems 索引页加入口；执行 `pnpm run gen-cordis-catalog` 重新生成目录。
- `docs/module-graph*.md`：按生成器重跑结果更新。
- `.agents/notes/implemented/architecture/2026-10-15-experimental-voice-conversation.md`：新增能力决策记录（能力缝划分、为什么 FSM 在客户端、全双工回声策略、无新 Session 事件的合规性、验证证据）。
- 快照判定（实现时确认）：本变更不新增 loop/Session 事件，模型可见面是普通用户消息；在实现中验证 bundle overlay 下 recorded-session 回放无新增事件类型，若 harness 要求 overlay 快照则补一条，否则在 Agent Note 记录豁免依据。

## Implementation Steps（依赖顺序）

1. **冻结第三方事实**：读 `node_modules/.pnpm/sherpa-onnx-node@1.13.8/.../non-streaming-tts.js` 的 JSDoc/签名（OfflineTts config 字段、generate 参数、numSpeakers）；下载 Kokoro multi-lang HF release，枚举 espeak-ng-data 与 dict 文件清单，计算 bytes/sha256，生成 `assets.json` 与 `voices.json`；确认 Windows/macOS/Linux `tar` 对 bz2 的支持矩阵。
2. 建 `text-to-speech` 服务定义包 + 单元测试（注册表、选择持久化、voice 归属校验、注销 join、follow 合并）。
3. 建 `text-to-speech-kokoro`：config→runtime（含归档解压/stamp）→inference/worker/process-server→synth-worker→plugin apply；测试与本地 e2e。
4. 建 `api-text-to-speech`（含 wire 校验/错误码/取消传播）。
5. 给 `client-ui-voice-input` 加 `./audio` 子路径导出（加门禁：现有 voice-input 测试全绿）。
6. 建 `client-ui-voice-conversation`：worklet/capture/echo-gate → playback/segment → fsm → UI 组件/mount/locale；client specs。
7. 建 `voice-conversation-bundle`（patch、图标、README、locale）+ 一个过 Loader 的**真实组合测试** cordis.yml（product-visible 插件硬要求；mock 仅外部网络/推理，断言 provider 注册、Remote 可调、bundle 激活卡数据）。
8. 工作区接线：ts references、政策清单、catalog/module-graph 生成、subsystem 双语文档、Agent Note。

## Dependencies and Considerations

- 不新增 npm 原生依赖：`sherpa-onnx-node@1.13.8` 已在锁文件且含 OfflineTts；模型走现有 HF/镜像首次下载准备模式。
- 实验隔离：新客户端插件以 peerDependencies 引用 release 包（session-controller、ui-conversation、slots 等）与 experimental 的 speech/api-speech；release 包零改动（voice-input 仅追加导出，不引入新依赖方向）。
- Model-visible ⟺ logged：音频与中间转写不入 Session；最终文本只经 `session.prompt` 成为普通用户消息；TTS 朗读的是普通 assistant turn。无需 SESSION_FORMAT_VERSION/SDK 联动。
- 全双工回声是多层防御，不是单点保证：① 浏览器平台 AEC（getUserMedia 约束）；② 播放期参考电平自适应门限 + 耳机检测告警；③ Host SenseVoice 内 Silero VAD 对非语音段返回空；④ 最近播放文本归一化子串守卫；⑤ barge-in 需持续能量+服务端 VAD 双条件。无 WebRTC render-reference AEC，开放扬声器场景的残余风险在 README 明示。
- 取消语义：合成 per-call AbortSignal；barge-in 取消 turn 使用既有 session cancel；新话语必须在 cancel 落地后提交（FSM 串行化），避免双 turn。
- 资源：TTS 与 ASR 各自串行 worker、独立 threads 配置（默认保守值 2）；模型 int8 首发；空闲回收复用现成机制。
- 安全：loopback 随机 token、动态端口、stdout 只出 readiness、子进程 cwd=dataRoot、`ELECTRON_RUN_AS_NODE=1`、token 用完从 env 删除——全部照搬已审过的 SenseVoice 模式。
- 配置化：断句阈值、门限、预取句数、默认 voice 等部署/体验项都是插件 Config（schemastery），不允许代码内硬编码可调项。
- 规范遵从：ESM、branded id、注册即 effect、typed events（本期无新事件）、locale-owned 文案、双语 README、文件末尾单换行、JSDoc 完整契约、无 `as unknown`。
- 图标：新 bundle 属 official experimental artwork，按 dsh-official-plugin-artwork 流程并获设计师批准后方可入库。

## Validation

- `pnpm --filter @deepseek-ai/dsh-experimental-text-to-speech test` 及同组各新包 focused 测试（vitest，含 client 面 `.client.spec.ts(x)`、Loader 真实组合测试）。
- `pnpm run build:artifacts` 后 `pnpm run build:check`（新包含 worker 多入口/客户端 bundle 面）。
- `pnpm run typecheck`、`pnpm run lint`、`pnpm run duplication`（重点核对未复制 audio.ts/runtime 下载逻辑）。
- `pnpm run hygiene`（publint/exports/NodeNext 消费者检查，新发布包）。
- `pnpm run doc-sync` + `pnpm run test:docs`（subsystem 双语页、cordis catalog 新鲜度、链接、doc budgets）。
- 构建产物冒烟：用 bundle overlay 启动 `pnpm dsh web`（按 AGENTS 用 picker overlay），手工冒烟麦克风→转写→发送→流式朗读→barge-in（无 DEEPSEEK key 时可用现有 replay/mock 路径；推理 e2e 自跳过）。
- 按 dsh-pre-push-checks 只跑与本变更匹配的检查，不全量重跑。

## Risks

- **Kokoro 资产含归档（tar.bz2）与 jieba dict 目录**，比 SenseVoice 单文件复杂：用系统 tar + stamp 校验，并保留 `dataDirectory/dictDirectory/modelDirectory` 手动覆盖配置（离线/loud-fail），与 ASR 手动模型目录对称。
- **voices.bin 的 voice 名→sid 映射**可能随模型版本变化：映射随锁定 revision 入库并在加载时用 `numSpeakers` 校验，失配即准备失败，禁止静默选错音色。
- **全双工扬声器回声残余**：四道守卫降低概率但不承诺开放扬声器完美；UI 明确建议耳机；真正 WebRTC/AEC render-reference 方案留后续。
- **AudioContext 16kHz 兼容性**（少数浏览器）：原生采样率 + worklet 降采样回退；桌面 Chromium/Electron 为主支持面。
- **图标审批阻塞**：合并门禁；未批准前 bundle 可先复用占位（不入库新 glyph），发布前必须替换。
- **全双工常开麦克的隐私感知**：显式模式开关、录制中持续可见指示、页面隐藏即停、不持久化音频；准备与录音状态在 UI 上始终可见。
- **scope 蔓延**：本地 Qwen、PWA、Brainstorm 编排本期一律不做；任何相关提交先回到计划重新批准。
