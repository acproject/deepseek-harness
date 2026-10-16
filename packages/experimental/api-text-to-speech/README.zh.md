---
description: "通过已认证的 Web Remote 暴露有界的临时语音合成。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-api-text-to-speech

[English](README.md) | 中文

## 概述

`tts` Remote 将浏览器语音客户端连接到 `ctx.textToSpeech`。它提供 Provider 与音色发现，以及一次完整文本的合成调用。

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

与语音合成服务定义和 Typert 组合使用。`maxTextChars` 和 `maxAudioBytes` 限制接收的文本和返回的音频。启用后，浏览器 UI 挂载此包生成的 `/remote` 贡献。

`prepare(providerId, { downloadSource })` 将一个已公布的源转发给 Provider；省略时沿用其配置策略。目录携带 `downloadSources` 供选择器使用。Provider 拒绝不可用的选择以及对进行中任务源的更改。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

`catalog()` 暴露 Provider 与音色身份、默认选择和接入限制。`synthesize()` 在解析所选 Provider 之前拒绝空文本或超长文本（以 Unicode 码点计），并拒绝超过配置字节上限的音频。认证与取消传输由现有网关负责。音频是临时的，不是 Session 事件或附件；朗读的文字由普通助手轮次拥有。

`follow()` 流式发送完整目录，包括准备状态和当前偏好。`prepare()` 启动或加入 Host 任务；`cancelPreparation()` 显式取消。`configure()` 持久化提供的偏好字段。观察者断开不会取消准备。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[本地 Kokoro Provider](../text-to-speech-kokoro/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为合成请求与准备不进入模型请求；朗读的文字由普通助手轮次拥有。

#### KV 缓存影响

没有直接影响；普通轮次生成拥有消息内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 不提供持久音频历史或流式协议；每次调用返回一个完整 WAV。Base64 带来额外传输开销；文本和音频均受已公布限制约束。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
