---
description: "按需准备和运行本地 CPU Kokoro 语音合成工作进程。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-text-to-speech-kokoro

[English](README.md) | 中文

## 概述

此 Provider 在 Host CPU 上通过 sherpa-onnx OfflineTts 使用 Kokoro 多语言 v1_0 ONNX 模型合成语音。各平台的 sherpa-onnx Node 包包含 ONNX Runtime；用户无需 Python、编译器或模型转换。它提供 53 个命名音色，覆盖中文和英语。启用时检查缓存资源，不加载模型或下载资源。

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

[Bundle](../voice-conversation-bundle/README.zh.md) 在 DSH 主目录下提供绝对 `dataRoot`。准备会下载一个固定修订的归档，校验大小与 SHA-256，使用系统 tar 解压到受管模型目录，校验固定模型文件，再加载模型。`precision` 默认为 `int8`，`fp32` 选择较大的参考权重。`modelDirectory` 提供包含所选 ONNX 模型、`voices.bin`、`tokens.txt`、两个词典和 `espeak-ng-data` 的已有绝对目录；手动目录跳过下载，文件内容由部署者负责。取消或失败后复用已完成并通过校验的文件。

下载归档前，Host 会比较配置的 `modelOrigins`，默认为 `https://github.com`；镜像部署可覆盖此列表。并发 HEAD 请求沿用固定发布路径，通过 Host 的 fetch 代理跟随重定向，先返回 2xx 的源优先下载。`modelProbeTimeoutMs` 默认为 3000 毫秒；所有探测均失败时按配置顺序下载。网络、HTTP、证书或完整性校验失败会尝试其他源；取消、解压失败、存储错误和未分类错误会停止准备。所有源都必须符合固定修订、大小和 SHA-256 校验值。响应延迟不代表下载吞吐量，完整下载仍受准备阶段的总超时约束。

显式 `modelOrigin` 仅使用指定源，不探测也不回退到公共源。只有一个地址的 `modelOrigins` 同样跳过探测。已校验的缓存和显式离线路径无需请求下载源。语音 UI 在准备或重试前提供已公布的下载源。手动选择仅覆盖本次任务，只使用指定源而不回退，且不能替换进行中任务的源。Host 拒绝配置之外的源；完全离线部署不公布下载源。

下载失败会标明归档与下载源，并提供原因分类，以及可用的 HTTP 状态或错误码。公开状态不包含 URL 凭据、查询参数和原始底层错误消息。重试复用已校验的归档与模型文件，未完成的下载重新开始。解压完整但缺少戳记、且固定文件哈希全部匹配时，会直接补写戳记而无需重新下载。

每次启用都会检查磁盘上的所选模型、音色表、词表、词典和 espeak 数据。缓存完整且校验通过后立即恢复就绪，首次合成再唤醒工作进程。文件缺失或托管文件校验不符时需要显式准备；路径不可读时报告错误。禁用插件或重启 Host 后，无需重新下载完好的缓存。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

一个托管 Node 子进程串行执行推理。唤醒期间提交的合成请求进入有界队列。工作进程在执行时要求资源处于就绪或待唤醒状态。合成不会启动准备下载。`threads` 调节 CPU 推理，`speed` 调节语速，`maxPending` 限制已接收任务数。准备和合成分别有截止时间。空文本、超长文本和未知音色在原生推理前被拒绝，保留已加载的工作进程；推理失败、响应格式错误和传输失败会回收进程。取消会终止运行中的工作进程并等待其进程范围退出；已取消的排队请求不会执行。`idleTimeoutMs` 在空闲后释放进程，零表示保留至插件释放。模型继续保留在缓存中。工作进程为每个请求返回一个完整的单声道 24 kHz 16 位 PCM WAV，音频不流式返回。带认证的环回请求仅在内存中保存音频。Electron 工作进程使用 Node 模式。

Host 在页面和 Session 变化期间拥有准备任务：检查资源、下载归档、解压、校验文件、加载工作进程。显式模型路径会省略下载与解压步骤。下载报告字节，其他步骤报告等待时间。空闲进程保留已准备路径，唤醒时只需加载模型。准备结果发布后再取消，只等待任务收尾，不会覆盖该结果。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[语音合成服务](../text-to-speech/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为合成请求与准备不进入模型请求；朗读的文字由普通助手轮次拥有。

#### KV 缓存影响

没有直接影响；普通轮次生成拥有消息内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 仅使用 CPU。原生包面向 macOS arm64/x64、Linux glibc arm64/x64 和 Windows x64；Windows ARM64 与 Linux musl 尚非已验证部署目标。INT8 模型解压后约 190 MB，FP32 约 390 MB；已校验的归档在被替换前同样保留，因此界面估算建议预留 600 MB 与 1.2 GB 磁盘。合成以整句为单位且非流式：完整 WAV 在生成结束后才返回，`maxTextChars` 默认为 500 个码点。一个串行工作进程一次只执行一次合成，并发请求排队，上限为 `maxPending`。Kokoro 音色表公开 53 个命名说话人（标识符 `af_*` 至 `zm_yunyang`）；原生运行时报告 54 个说话人槽位，最后一个槽位没有发布的音色。未使用 jieba `dict/` 目录；中文规范化使用随附的数字、日期和电话 FST。开放扬声器上的常开语音对话建议使用耳机；残余回声处理属于对话客户端，不属于此 Provider。禁用插件保留模型缓存。桌面发行包仍需各平台签名和音频权限验收；Linux 桌面分发不属于此 Provider。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

真实模型测试为显式开启：将 `DSH_TTS_E2E_ROOT` 设为空的数据目录（可选设置 `DSH_TTS_E2E_MODEL` 指向已校验的解压目录，以及 `DSH_TTS_E2E_PRECISION=fp32`），再通过 e2e Vitest 配置运行包内的 `local.e2e.ts`。

</details>
