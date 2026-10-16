---
description: "具名实验性语音合成 provider、音色选择与取消归属。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-text-to-speech

[English](README.md) | 中文

## 概述

本服务定义通过 `ctx.textToSpeech` 选择具名语音合成器。消费者在执行前先 resolve 请求；provider 各自独立注册，且每个 provider 声明自己的音色。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

通过[语音对话 bundle](../voice-conversation-bundle/README.zh.md)加载，或自行组合服务、provider 与消费者。`defaultProvider` 与 `defaultVoice` 必填，分别精确选择已注册的 provider 与音色；bundle 提供 `kokoro-local` 与 `zf_xiaobei`。`language` 是调用方省略时使用的语言提示。provider 缺失或重复、音色未知、语言不受支持都会显式失败。

provider 通过 `downloadSources` 声明准备下载源。`prepare(id, options)` 可为单次任务转发可选的 `downloadSource`；provider 会校验该选择，并拒绝在准备进行中切换来源。省略时沿用 provider 策略。来源选择不会持久化为合成偏好。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节 — 点击展开</summary>

`resolve()` 捕获 provider 实例以及文本、音色和语言。`synthesize()` 会拒绝已撤回或被替换的注册。注册 disposer 关闭准入、中止已接受请求并 join provider 的收尾；provider 必须响应取消。不存在选择其他合成器或把文本发往别处的 fallback。

`defaultProvider`、`defaultVoice` 与 `language` 是 volatile 配置字段：`configure()` 通过 `settings` 服务把传入字段写入本插件的 profile 条目，运行实例无需重新挂载即可读到更新；在保存覆盖前使用组合默认值。Settings 按配置 id（`entry.options.id`）定位条目，不经过 Loader 的 Include 路径。缺少 `settings` 或 profile 条目时 `configure()` 失败；保存前会拒绝未知音色或所选音色不支持的语言。provider 自有的准备流程复用语音识别的准备状态词汇，通过完整 `SynthesisSnapshot` 观察；关闭观察者不会取消准备。

合成结果是规范的单声道 PCM16 WAV 字节并带采样率。服务本身不播放也不流式传输音频；播放由消费者负责。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[语音对话子系统](../../../docs/subsystems/voice-conversation.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无；合成消费的是已完成的助手或客户端文本，从不进入模型请求。

#### KV Cache 影响

无影响；合成位于模型对话之外。

## 已知限制与延后事项

<a id="known-limitations-and-deferred-work"></a>

- 仅支持整段文本的一次性合成。流式 token 转语音、声音复刻与云端 provider 暂无服务方法。
- 准备状态类型与语音识别共用并沿用其词汇，包含 TTS 不会使用的 `vad` 步骤类型。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节 — 点击展开</summary>

无。

</details>
