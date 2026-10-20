---
kind: upgrade-guide
description: "The voice-conversation bundle defaults synthesis to macOS system speech on darwin instead of Kokoro."
---

# Voice conversation defaults to macOS system speech on darwin

English | [中文](guide.zh.md)

## Change

On macOS, the experimental voice-conversation bundle now defaults the synthesis service to the `macos-say` provider with the voice `Tingting (中文（中国大陆）)`; other platforms keep `kokoro-local` with `zf_xiaobei`. The new provider synthesizes through the system `say` command and needs no model preparation. Users who enabled the bundle on macOS and never overrode the synthesizer or voice hear the system voice after upgrading; an overridden selection persists unchanged, and Kokoro remains registered and selectable.

## Migration

1. To keep Kokoro on macOS, open the Voice Conversation bundle details in Plugins, select the `kokoro-local` provider and a Kokoro voice such as `zf_xiaobei`; the choice persists through the Settings service.
2. To accept the default, do nothing. Confirm by starting a voice conversation on macOS: bundle details show the `macos-say` provider and answers are spoken by `Tingting` without any preparation step.
