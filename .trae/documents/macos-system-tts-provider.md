# macOS 系统 TTS Provider（text-to-speech-macos）

## Context

语音对话功能当前默认使用本地 Kokoro TTS（`packages/experimental/text-to-speech-kokoro`），音质不理想。用户希望改用 macOS 系统自带语音（`say` 命令），先做 macOS（Windows SAPI 后续另立包）。目标：新增 `say` provider 并在 macOS 上设为默认，Kokoro 保留为可切换的备选（客户端 PreparationCard 已有 provider/voice/language 切换 UI）。

已确认的关键契约事实：
- Provider 接缝在 `packages/experimental/text-to-speech/src/`：`SynthesisProvider = { info, preparation?, synthesize(input, signal) }`；**省略 `preparation` 即视为 ready**（`snapshot()` 默认 `{ phase: 'ready' }`），无需任何下载/准备流程。
- `SynthesisResult` 要求 canonical **mono PCM16 WAV** + `sampleRate`/`audioSeconds`/`synthesisSeconds`。
- 本机 `say -v '?'` 已验证：187 个语音，格式 `VoiceName  locale  # comment`，名称可含空格/中文（`Tingting (中文（中国大陆）)  zh_CN  # 你好！我叫婷婷。`），存在重名（Tingting×2、Meijia×2，质量变体）。中文语音含 Tingting/Meijia/Sinji（经典）与 Eddy/Flo/Grandma 等新式语音。

## 第 0 步：实证探针（写代码前先跑）

1. `say -v 'Tingting (中文（中国大陆）)' --file-format=WAVE --data-format=LEI16@24000 --channels=1 -o /tmp/probe.wav -f - <<< '你好'`，hexdump 验证 RIFF/fmt=PCM/ch=1/bits=16/rate=24000；并跑一次**不带** `--channels=1` 确认 mono 是否默认。
2. 裸名解析：`say -v Tingting` 是否可解析（仅记录行为，id 一律用全名）。
3. `-f -`（stdin 读文本）与 `-o`/`--data-format` 组合可用性；空文本退出码。
4. `!!js` 三元表达式在 bundle `config:` 值中的可用性（AGENTS.md 允许 config 下用 `!!js`；repo 内已有 `disabled: !!js` 先例，config 值需 loader 冒烟验证）。失败则回退：共享 patch 保持 kokoro 默认 + 用户本地 overlay 切 macOS（不发布默认切换）。

## 新包：`packages/experimental/text-to-speech-macos`

结构（模板 = `text-to-speech-kokoro`）：

```
package.json  tsconfig.json  tsdown.config.ts
src/index.ts  src/config.ts  src/platform.ts
src/voices.ts  src/input.ts  src/synthesizer.ts
locale/en.json  locale/zh.json
README.md  README.zh.md  README.i18n.yaml
tests/voices.spec.ts  tests/provider.spec.ts
tests/synthesizer.spec.ts  tests/local.e2e.ts
```

- 包名 `@deepseek-ai/dsh-experimental-text-to-speech-macos`；插件名 `experimental-text-to-speech-macos`；provider id 默认 `macos-say`；显示名 `macOS System Speech (say)`；`inject = ['textToSpeech', 'subprocess']`。
- `src/config.ts`（schemastery，逐字段对照 kokoro 惯例）：`providerId`('macos-say')、`command`('say'，部署可变 + 测试 seam)、`locales`(['zh','en']，按 locale 主子标签过滤语音目录)、`rateWpm?`(省略=各语音原生语速)、`sampleRate`(24000)、`maxTextChars`(500，与 api 层一致)、`maxAudioBytes`(16MB)、`voiceListTimeoutMs`(10s)、`synthesisTimeoutMs`(60s)、`graceMs`、`maxLogBytes`。**不设 maxPending**：每次请求独立进程、无共享 worker（不对称性写入 README，不造假上限）。
- `src/platform.ts`：`assertDarwinHost(platform = process.platform)` 非 darwin **抛错**（fail loud，先例：`packages/experimental/cua-macos/src/native-build.ts:20`）；跨平台安全由 bundle 的 `disabled:` 门控保证。
- `src/voices.ts`：右锚定正则解析 `say -v '?'` 输出（locale token 锚定切分，兼容空格/中文名）；按完整 CLI 名**去重**（保留首条）；按 `locales` 过滤（zh→zh_CN/zh_TW/zh_HK，en→en_US/en_GB/…）；映射遵循 kokoro voices 约定：`zh*`→`['auto','zh','en']`、`en*`→`['auto','en']`、其他→`['auto',<主子标签>]`；`id`=完整 CLI 名，`name`=comment 去尾部句号（回退 CLI 名）；过滤后为空则 activation 抛错。
- `src/synthesizer.ts`：**每请求 spawn**（`say` 无模型加载、原生 CLI、免取消状态，与 kokoro 常驻 worker 相反，README 说明）。流程：`validateText` + 未知 voiceId 拒绝 → tmpdir 临时 WAV（`dsh-tts-macos-<hex>.wav`，`finally` 无条件 `rm force`）→ argv：`--file-format=WAVE --data-format=LEI16@<rate> --channels=1 [-r <wpm>] -o <tmp> -f -`，**文本走 stdin**（`say` 无 `--` 结束符，stdin 杜绝文本被当 flag 解析）→ `dsh-timeout` deadline + abort（kokoro 同款）→ 非零退出带 stderr 抛错 → 读文件、`maxAudioBytes` 上限、`validateWav`（RIFF 遍历：fmt=PCM/mono/16bit/rate 匹配，立体声/非 PCM **拒绝**而非静默降混）；`audioSeconds = dataBytes/2/rate`。
- `src/index.ts`：`async apply`：`assertDarwinHost()` → spawn `say -v '?'`（stdout 限 `maxLogBytes`、`voiceListTimeoutMs`）→ 解析/去重/过滤 → `ctx.effect(() => ctx.textToSpeech.register({ info: {...}, synthesize }))`，返回 disposer。无 `preparation`。

## 测试（覆盖 CI 全平台跑，per-file 100% 门）

- `voices.spec.ts`：解析 fixture（空格名/中文名/重名/无 comment/空行）、locale 过滤、语言映射、空目录拒绝。
- `provider.spec.ts`：mock subprocess + `vi.mock('../src/platform.ts')` 使 Linux/Windows CI 可挂载（kokoro 先例 `provider-queue.spec.ts:13`）；断言注册进 `snapshot()`、`preparation.phase==='ready'`、disposer 注销、非 darwin 抛错、语音列表失败/空过滤抛错。
- `synthesizer.spec.ts`：argv 构造（含 stdin 文本）、WAV 秒数计算、abort 中断 + 临时文件清理、超时、非零退出带 stderr、超大/畸形 WAV（stereo/8bit/错采样率/截断）拒绝、各路径均清理临时文件。
- `local.e2e.ts`：`DSH_TTS_MACOS_E2E=1` + darwin 才跑真实 `say`（固化探针 1–3），目标语音 `Tingting (中文（中国大陆）)`。

## 接线（开发版 Desktop 的生效配置就是 bundle patch）

`packages/experimental/voice-conversation-bundle/cordis.patch.yml`：

```yaml
- id: text-to-speech
  config:
    defaultProvider: !!js process.platform === 'darwin' ? 'macos-say' : 'kokoro-local'
    defaultVoice: !!js process.platform === 'darwin' ? 'Tingting (中文（中国大陆）)' : 'zf_xiaobei'
    language: auto
- id: text-to-speech-macos
  name: '@deepseek-ai/dsh-experimental-text-to-speech-macos'
  disabled: !!js process.platform !== 'darwin'
```

- bundle `package.json` dependencies 增加 `"@deepseek-ai/dsh-experimental-text-to-speech-macos": "workspace:*"`（verify-cordis-config 要求）。
- bundle README（en/zh + i18n 记录）与 package.json description 补充新插件。
- **无需**改用户本地 profile：`apps/desktop/src/project-manager.ts:37-40` 开发模式自动加载 bundle，本地 `~/.dsh/profiles/desktop/cordis.patch.yml` 与 `.desktop-build/.../home` 均不覆盖 TTS 配置。

## 注册与门禁

- `tsconfig.host.json` 增加 `packages/experimental/text-to-speech-macos` 引用。
- `scripts/verify-package-readme-model-experience.ts` 增加条目（kind: 'none'，理由：系统 say 本地合成，不改模型上下文与 Session 事件）。
- `packages/experimental/README.md` Packages 表加一行（text-to-speech 家族当前缺行是既有缺口，至少补新行）。
- `docs/config-catalog.md`、`docs/module-graph.md` 等仅由 `pnpm run doc-sync` 再生成。
- 不需要动：pnpm-workspace（glob 覆盖）、product-package-policy（experimental 豁免）、官方 bundle catalog。

## 文档

- README.md/zh 按 kokoro 章节结构：frontmatter `kind: "package-reference"`、Summary、TOC、Use this package、Understand the implementation（stdin 送达理由、每请求 spawn 理由、WAV 校验）、Further Exploration、Model Experience（None）、Known Limitations（仅 darwin；音色随系统；zh 语音的 auto 混读英文带口音；无队列上限的设计原因）、Dev Note（e2e 环境变量）。
- `README.i18n.yaml` 用 `verify-translation-pairing --write` 生成。
- `locale/en.json`/`zh.json`：meta.title/description。

## 验证

1. 探针（第 0 步）→ 必要时修正 argv/校验常量。
2. 新包 vitest 全绿；`pnpm run build:artifacts` + `build:check`。
3. `pnpm run doc-sync`（README 结构、config-catalog 再生成、翻译配对）。
4. `pnpm run hygiene`（publint/manifest 检查新包与 bundle 依赖）。
5. 真机 e2e：`DSH_TTS_MACOS_E2E=1` 跑 `tests/local.e2e.ts`。
6. 重启 dev Desktop：语音 UI 应显示 `macOS System Speech (say)` 为默认且选中婷婷，播放一句验证；UI 切回 Kokoro 验证备选可用。
7. 升级指南：bundle 默认从 `kokoro-local`/`zf_xiaobei` 切到 `macos-say` 属外部可感知变更，用 dsh-create-upgrade-guide 记录（默认切换 + 如何恢复 Kokoro）。

## 风险

- `!!js` 三元用于 config 值无 in-repo 测试先例 → 探针 4 先验证；失败回退方案见上。
- 新式语音若忽略 `--data-format`/`--channels` 会 fail loud（可接受，记入限制）。
- 重名语音由 CLI 自行裁决质量变体；id 含 locale 括号后缀，跨列表稳定。
- 默认音色（婷婷）为口味之选，UI 可随时切换。
