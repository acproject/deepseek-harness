---
description: "在插件管理中启用实验性常开语音对话。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-voice-conversation-bundle

[English](README.md) | 中文

## 概述

此可选 Bundle 组合语音识别与语音合成两条服务定义、本地 SenseVoice 与 Kokoro Provider、macOS 系统语音、鉴权 Remote 以及常开浏览器语音闭环。出厂配置默认不启用。

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

在 Web 侧边栏打开插件管理，启用蓝色语音波形图标的“语音对话”。本地 SenseVoice 识别模型，以及作为平台默认合成器的 Kokoro，首次使用前都需要准备：安装引导提供“前往安装”和“稍后”，在 Bundle 详情中显式开始下载，并显示进度与失败详情。macOS 上默认合成器是系统语音，无需准备。识别与合成就绪后，在输入区展开麦克风活动入口，允许麦克风访问后正常说话；句尾静音会将转写作为消息提交，助手回复的完整句子依次朗读。在播放时开口可打断回答并发送新语句。识别 Provider、语言、语音和麦克风偏好在 Bundle 详情中通过 Settings 服务保存。检测不到耳机输出时，活动入口提示扬声器回声风险；建议佩戴耳机。禁用 Bundle 会停止监听并取消进行中的任务；已缓存资产保留在磁盘上。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

静态 `cordis.patch.yml` 插入八行：默认识别 Provider 为 `sensevoice-local` 的语音服务、使用 `dshHomePath` 缓存目录的 SenseVoice Provider、语音 Remote、合成 Provider 与默认语音按平台取值（macOS 上为 `macos-say` 与 `Tingting (中文（中国大陆）)`，其他平台为 `kokoro-local` 与 `zf_xiaobei`）、语言为 `auto` 的合成服务、使用独立 `dshHomePath` 缓存目录的 Kokoro Provider、在非 darwin 平台禁用的 macOS 系统语音 Provider、合成 Remote，以及浏览器语音对话贡献。按设计不挂载按键说话的语音输入插件；浏览器贡献只导入该包纯 WAV 编码的 `./audio` 子路径。可选 Bundle 安装后可在插件管理中使用，但不会进入默认 profile。浏览器贡献拥有自己的生成式 Remote 挂载；稳定 API Remote 不导入实验代码。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[语音对话子系统](../../../docs/subsystems/voice-conversation.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为音频采集、转写和合成不进入模型请求；模型可见文字由普通用户消息提交拥有。

#### KV 缓存影响

没有直接影响；普通提交拥有消息内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 首个 Bundle 只提供一个本地识别 Provider（SenseVoice）和两个合成 Provider：darwin 上默认的 macOS 系统语音，以及其他平台上默认的本地 Kokoro（中英双语语音）。更多 Provider 可用不同 id 注册到同一服务；云服务需要显式新增 Provider 与凭据配置。本 Bundle 不新增模型工具、唤醒词，也不改动 agent loop。
- 尽管有多层回声防御，开放扬声器环境仍存在残余自触发风险；可靠用法是佩戴耳机。合成按句进行，不是 token 级流式。
- 即使禁用本 Bundle，安装 dsh 仍会安装 `sherpa-onnx-node` 及其平台相关原生运行时（含 ONNX Runtime）。运行时安装的磁盘与下载成本独立于“下载并准备”获取的模型；原生包体积随平台和版本变化。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
