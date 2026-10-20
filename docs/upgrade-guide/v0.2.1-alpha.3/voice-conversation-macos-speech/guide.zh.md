---
kind: upgrade-guide
description: "语音对话 bundle 在 darwin 上的默认合成改为 macOS 系统语音，不再默认 Kokoro。"
---

# 语音对话在 darwin 上默认使用 macOS 系统语音

[English](guide.md) | 中文

## 变更

在 macOS 上，实验性语音对话 bundle 的合成服务默认切换为 `macos-say` Provider 与语音 `Tingting (中文（中国大陆）)`；其他平台保持 `kokoro-local` 与 `zf_xiaobei`。新 Provider 通过系统 `say` 命令合成，无需模型准备。在 macOS 上启用过 bundle 且从未覆盖合成器或语音的用户，升级后会听到系统语音；已覆盖的选择保持不变，Kokoro 仍保持注册且可选择。

## 迁移

1. 要在 macOS 上继续使用 Kokoro，打开插件管理中语音对话 bundle 的详情，选择 `kokoro-local` Provider 和一个 Kokoro 语音（如 `zf_xiaobei`）；该选择通过 Settings 服务持久化。
2. 接受默认则无需操作。在 macOS 上发起一次语音对话即可确认：bundle 详情显示 `macos-say` Provider，回答由 `Tingting` 朗读且无需任何准备步骤。
