---
description: "通过 macOS 内置 say 命令合成语音。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-text-to-speech-macos

[English](README.md) | 中文

## 概述

此 Provider 在 Host 上运行 macOS 内置的 `say` 命令合成语音。没有模型下载、解压或准备流程：启用时列出系统已安装的语音并注册，Provider 立即就绪。音质取决于机器上安装的系统语音，包括婷婷（Tingting）等增强中文语音。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

[Bundle](../voice-conversation-bundle/README.zh.md) 在 darwin 上启用此插件，并默认选择 `macos-say` 与婷婷音色；在其他平台上插件保持禁用，Kokoro 仍为默认。语音 UI 可以随时在此 Provider 与 Kokoro 之间切换，所有已安装的系统语音都以目录名称列出。

配置覆盖部署可变的选项：`command` 覆盖可执行文件路径，`locales` 按主语言子标签过滤目录（默认 `zh` 与 `en`），`rateWpm` 设置每分钟词数的语速或保持各音色原生语速，`sampleRate` 请求输出采样率（默认 24000 赫兹）。`maxTextChars` 限制请求文本，`maxAudioBytes` 限制产出的音频，`voiceListTimeoutMs` 与 `synthesisTimeoutMs` 分别约束两个子进程阶段。文本默认上限 500 个码点，与 Kokoro Provider 的约定一致。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

每次合成都新起一个 `say` 进程，并在每条退出路径上删除临时 WAV 文件。这与 Kokoro Provider 的常驻工作进程有意不同：`say` 没有模型加载，按请求起进程只增加进程启动开销，不保留需要取消或回收的共享状态，并让子进程服务各自管理进程范围。请求文本经 `-f -` 走标准输入，因为 `say` 没有选项结束标记，stdin 送达使文本永远不会被当作命令行选项解析。输出文件按 RIFF/WAVE 校验：格式块必须是配置采样率的单声道 PCM16，`FLLR` 等未知块按声明大小跳过，立体声或非 PCM 输出直接拒绝而不做降混。音色 id 是 `say -v '?'` 输出的确切 CLI 名称；能顺读英文的中文语音按 Kokoro 的语言约定公布 `auto`、`zh` 与 `en`。目录缺失或过滤后为空会使启用失败并报错；没有准备阶段，注册表直接报告 Provider 就绪。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[语音合成服务](../text-to-speech/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为合成请求不进入模型请求；朗读的文字由普通助手轮次拥有。

#### KV 缓存影响

没有直接影响；普通轮次生成拥有消息内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 仅限 darwin；插件在其他平台禁用，Bundle 在其他平台上保持 Kokoro 默认。目录跟随机器上安装的语音，因此一台主机上选择的音色 id 在另一台上可能不存在；语音 UI 列出当前主机提供的语音。忽略 `--data-format` 或 `--channels` 的语音会在 WAV 校验中直接失败，而不是产出采样不匹配的音频。与 Kokoro 不同，这里没有 `maxPending` 上限：每个请求拥有自己的进程，并发请求不会在共享工作进程后排队，进程调度由操作系统负责。中文语音在 `auto` 语言下顺读英文会带口音；在 UI 中切换语言提示可以改选专用英文语音。`rateWpm` 对所有音色统一生效；未来的 Windows 系统语音 Provider 另行延后。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

真实 `say` 测试在 darwin 主机上显式开启：设置 `DSH_TTS_MACOS_E2E=1`，再通过 e2e Vitest 配置运行包内的 `local.e2e.ts`。

</details>
