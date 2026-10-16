# Agent Note：实验性常开语音对话与本地语音合成

Status: implemented

[English](2026-10-15-experimental-voice-conversation.md) | 中文

## Problem

语音输入 Bundle 止步于可确认的转写文字。对话式语音模式需要反向通路：助手回答必须能发声，播放必须与常开麦克风共存，用户必须能够打断。在开放声场中同时运行识别与播放存在自触发风险，而新建第二套 ASR 栈会重复已交付的 SenseVoice 接缝。

## Decision

三个新包加一个 Bundle 组成该特性，全部位于 `packages/experimental/` 且默认禁用：`text-to-speech` 服务定义、`text-to-speech-kokoro` Provider、`api-text-to-speech` Remote，以及 `client-ui-voice-conversation` 浏览器闭环。`voice-conversation-bundle` 补丁挂载七行：两个服务、两个本地 Provider、两个 Remote 和一个浏览器贡献。按键说话的语音输入插件按设计不挂载；浏览器闭环只导入该包无状态的 `./audio` WAV 编码子路径，识别原样复用既有服务、Remote 和 SenseVoice 契约。冻结范围排除本地 Qwen 适配器、移动端/WebRTC 伴侣和想法图头脑风暴服务；本 Note 只覆盖语音问答闭环。

首个合成器选用 sherpa-onnx `OfflineTts` 的 Kokoro 多语言 v1_0：单个 int8 归档、24 kHz 单声道 WAV、中英双语语音，Bundle 默认语音 `zf_xiaobei`、语言 `auto`。合成按句非流式进行。助手语音 feed 只消费基线之上的 append 型持久助手内容与瞬时增量，对修订去重，发出完整句子和一个结算时尾部片段；Provider 配置为每次调用一个句子，因此句子是最小可打断单元。按句任务独立中止；新回合和 interrupted attempt 结算会排空按键播放 FIFO。

回声防御共五层：麦克风轨道上的浏览器回声消除、降噪和自动增益；感知播放状态的起始门限（显著更高并需短暂确认的插话电平）加尽力耳机检测，未检出耳机时降级为扬声器警告；带校准噪底和插话待确认的能量 VAD；在 TTL 内拒绝与近期朗读文本相同转写的归一化文本回声守卫；以及插话发送前先取消当前 agent 回合的回合规则。没有任何单层被视为充分；包 README 仍将开放扬声器用法列为残余风险并建议佩戴耳机。

采集通过 AudioWorklet（回退 ScriptProcessor）将麦克风重采样为 16 kHz 单声道，保留 250 毫秒预滚并补齐句尾静音，因此一套 VAD 即可服务识别，无需第二个原生组件。每个 Session 通过 sessions 绑定创建一个 controller，随槽释放；两份目录 `follow()` 镜像在整个插件内各以一个流共享，载波失败不改写镜像。会话事件源与绑定拥有者共享；controller 不新增第二条事件订阅路径。音频帧和转写不写入 Session 事件，因此模型可见文字仍是普通提交消息，Session 日志可重建每个模型输入。

## Alternatives considered

流式 TTS Provider 可降低首音延迟，但需要 token 级音频分帧、增量播放取消和部分文本修订语义，而按句 feed 与现有 Provider 不具备这些；按句合成是最小完整单元。第二套浏览器 ASR 栈或云识别会重复 Provider 接缝或静默改变语音处理位置。浏览器原生识别无法统一保证本地处理。唤醒词、常开云传输和面向移动伴侣的全双工 WebRTC 明确不在范围内。直接复用语音输入插件会把常开闭环耦合到按键说话 UI 生命周期，因此只导入其无状态 WAV 编码器。

## Consequences

首次使用通过既有准备词汇下载两个本地模型（SenseVoice 与 Kokoro）；合成准备以别名复用语音准备状态类型，而不是另造并行状态机。“本地”仍指 Host 所在机器。非流式按句播放在高负载下有可感知的句间延迟；实验范围内接受这一点并写入包限制。

验证覆盖句子切分与 feed 结算、VAD 校准/插话转换、回声拒绝、插话顺序、按 Session controller 生命周期，以及使用注入式采集/播放 fake 的 Remote 失败隔离，另加挂载组合和客户端组件测试。Kokoro Provider 有真实推理 e2e 测试，字节相等断言已放宽。客户端 bundle 纯度受门禁；只有声明注入的包才能跨越 bundle 边界。原生运行时的 Windows、Linux 和签名安装包验收仍沿用语音输入政策。
