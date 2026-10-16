---
description: "与智能体保持连续语音对话：常开监听、本地转写和本地语音播放。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-voice-conversation

[English](README.md) | 中文

## 概述

此可选浏览器插件在会话输入区添加可展开的语音活动入口。当语音识别和语音合成均就绪时，麦克风保持常开，能量 VAD 依据句尾静音切分语句，转写文字作为普通用户消息发送，助手回复的完整句子会依次合成并播放。回答播放期间开口说话会打断播放，并以插话方式提交新语句。识别、合成与模型准备偏好放在 Bundle 详情中。

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

在插件管理页启用[语音对话 Bundle](../voice-conversation-bundle/README.zh.md)。缓存检查后，缺少本地识别或合成模型时弹出安装引导，可选择“前往安装”或“稍后”；弹窗打开 Bundle 详情，准备工作需在那里显式开始。任一目录断连或所选 Provider 未就绪时，点击入口只会打开同一引导而不会开始采集。Provider、语言和语音偏好以及准备进度放在 Bundle 详情中，旁边是原生输入设备选择器，可跟随系统默认设备或选择浏览器麦克风，选择结果独立于 Host 识别设置单独记住。

就绪后展开入口并允许麦克风访问。活动行显示实时电平和阶段标签：校准、聆听、听到、转写中、思考中或朗读中。收起活动行或离开页面会停止采集并释放麦克风。麦克风轨道请求浏览器的回声消除、降噪和自动增益。检测不到耳机输出时，活动行提示扬声器播放可能漏入识别；可靠用法仍是佩戴耳机。助手朗读期间，起始能量必须显著更高并经短暂确认才算插话；新语句发送前会先取消正在进行的回合。归一化后与助手刚朗读内容相同的转写会作为残余回声丢弃。不含字母或数字的语句、Remote 返回的空转写以及停止后的迟到结果都会被忽略，不触碰会话。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

每个 Session 通过 sessions 绑定拥有一个 controller；输入区槽工厂在首次使用时创建，release 时释放。两份目录镜像通过 Remote follow 流在每个插件内只订阅一次；载波失败只翻转 connected 标记，不改写最后一份目录。采集将麦克风流重采样为 16 kHz 单声道（优先 AudioWorklet，回退 ScriptProcessor），保留 250 毫秒预滚、在句尾补齐 250 毫秒静音，能量门依次经历校准、静音、插话待确认、说话状态。播放是按键 FIFO 队列；新回合会中止所有待执行合成任务、取消排队音频并停止播放，attempt 被 interrupted 结算时对该 attempt 执行同样处理。助手语音 feed 只消费基线之上的 append 型持久助手内容和瞬时增量，发出完整句子并在结算时补发一个尾部片段，且对修订去重。每句话是一次非流式合成请求，文本长度以 TTS Provider 的上限封顶。回声防御分层：浏览器回声消除、感知播放状态的起始门限加耳机检测、能量 VAD、归一化文本守卫，以及双条件插话确认。音频帧和转写绝不进入 Session 日志；只有发送出去的普通消息对模型可见。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[语音对话子系统](../../../docs/subsystems/voice-conversation.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为音频帧、识别结果与合成不进入模型请求；提交的转写是普通用户消息，与文字输入完全一致。

#### KV 缓存影响

除普通提交消息外没有直接影响。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 尽管有多层守卫，开放扬声器环境仍存在残余自触发风险，建议佩戴耳机。“本地”指 Host 所在机器，可能与浏览器所在机器不同。合成按句进行而非 token 流式；没有唤醒词；内置语音和语言随所选 Provider（Kokoro 提供中文和英文）。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
