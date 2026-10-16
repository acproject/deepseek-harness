---
description: "Hold a continuous voice conversation with the agent: always-on listening, local transcription and local speech playback."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-voice-conversation

English | [中文](README.zh.md)

## Summary

This optional browser plugin adds an expandable voice activity to the conversation composer. When both speech recognition and speech synthesis are ready, the microphone stays on, an energy VAD closes utterances from end-of-speech silence, transcripts are sent as ordinary user messages, and completed assistant sentences are synthesized and spoken in order. Speaking while the answer plays interrupts playback and submits the new utterance as a barge-in. Recognition, synthesis and model preparation preferences live in bundle details.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Enable the [voice conversation bundle](../voice-conversation-bundle/README.md) from Plugins. After cache inspection, a missing local speech or synthesis model triggers a setup prompt with Go to setup and Later actions; the prompt opens bundle details, where preparation starts explicitly. While either catalog is disconnected or the selected provider is not ready, clicking the activity opens the same guidance instead of starting capture. Provider, language and voice preferences and preparation progress live in bundle details, alongside a native input-device selector that follows the system default or a chosen browser microphone and is remembered independently of Host recognition settings.

Once ready, expand the activity and allow microphone access. The row shows the live input level and a phase label: calibrating, listening, hearing, transcribing, thinking or speaking. Closing the row or leaving the page stops capture and releases the microphone. The browser's acoustic echo cancellation, noise suppression and automatic gain control are requested on the microphone track. When no headphone output is detectable, the row warns that loudspeaker playback can leak into recognition; headphones remain the reliable configuration. While the assistant speaks, onset needs a much higher, briefly confirmed energy level to register barge-in; the running turn is cancelled before the new utterance is sent. Transcripts that normalize to text the assistant just spoke are discarded as residual echo. Utterances with no letters or digits, empty Remote transcripts and in-flight results after stop are ignored without touching the conversation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

One controller is owned per Session through the sessions binding; the composer slot inject factory creates it on first use and its release disposes it. Two catalog mirrors subscribe once per plugin via the Remote follow streams; carrier failures flip a connected flag without rewriting the last catalog. Capture resamples the microphone stream to 16 kHz mono (AudioWorklet with a ScriptProcessor fallback), keeps 250 ms of pre-roll, pads 250 ms of closing silence and runs the energy gate through calibration, silence, barge-pending and speaking states. Playback is a keyed FIFO queue; a new turn aborts every pending synthesis job, cancels queued clips and stops playback, and interrupted attempt settlements do the same for that attempt. The assistant speech feed consumes only appended durable assistant content and transient deltas above the subscription baseline, emits completed sentences plus one tail fragment at settlement, and deduplicates revisions. Each sentence is one non-streaming synthesis request capped by the TTS provider's maximum text length. Echo defense is layered: browser echo cancellation, playback-aware onset thresholds with headphone detection, the energy VAD, normalized-text echo guarding, and the dual-condition barge-in confirmation. Audio frames and transcripts never enter the Session log; only the ordinary sent message is model-visible.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Voice conversation subsystem](../../../docs/subsystems/voice-conversation.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as audio frames, recognition results and synthesis stay outside model requests; the submitted transcript is an ordinary user message, exactly like typed input.

#### KV Cache effect

No direct effect beyond the ordinary submitted message.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Open-air loudspeaker use still carries residual self-triggering risk despite layered guarding; headphones are recommended. “Local” means the Host machine, which can differ from the browser's machine. Synthesis is sentence-by-sentence rather than token streaming, there is no wake word, and bundled voices/languages follow the selected provider (Kokoro ships Chinese and English).

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
