---
description: "Enable experimental always-on voice conversation from the plugin manager."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-voice-conversation-bundle

English | [中文](README.zh.md)

## Summary

This optional bundle composes speech and synthesis Service Definitions, local SenseVoice and Kokoro providers, authenticated Remotes and the always-on browser voice loop. Shipped profiles leave it disabled.

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

Open Plugins in the Web sidebar and enable Voice Conversation, marked by a blue speech-wave icon. Both local models need preparation before first use: a setup prompt offers Go to setup or Later, and bundle details starts downloads explicitly with progress and failure detail. Once both providers are ready, expand the microphone activity in the composer, allow microphone access and talk normally; end-of-speech silence submits the transcript as a message, and completed answer sentences are spoken in order. Speaking over playback interrupts the answer and sends the new utterance. Bundle details store recognizer, language, voice and microphone preferences through the Settings service. When no headphone output is detectable, the activity warns about loudspeaker echo; headphones are recommended. Disabling the bundle stops listening and cancels active work; cached assets remain on disk.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The static `cordis.patch.yml` adds seven rows: the speech service defaulting to `sensevoice-local`, the SenseVoice provider with a `dshHomePath` cache directory, the speech Remote, the synthesis service defaulting to `kokoro-local` with voice `zf_xiaobei` and language `auto`, the Kokoro provider with its own `dshHomePath` cache directory, the synthesis Remote, and the browser voice-conversation contribution. The push-to-talk voice input plugin is intentionally not mounted; the browser contribution imports only the pure `./audio` WAV-encoding subpath of that package. Optional-bundle installation makes the package available to management without selecting it in default profiles. The browser contribution owns its generated Remote mounts; stable API Remotes do not import experimental code.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Voice conversation subsystem](../../../docs/subsystems/voice-conversation.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as audio capture, transcripts and synthesis remain outside model requests; ordinary user submission owns the model-visible text.

#### KV Cache effect

No direct effect; ordinary submission owns the message content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The initial bundle supplies one local recognizer (SenseVoice) and one local synthesizer (Kokoro, Chinese and English voices). Additional providers register with the same services under distinct ids; cloud services require explicit new providers and credential configuration. The bundle adds no model tool, no wake word and no agent-loop change.
- Open-air loudspeaker use still carries residual self-triggering risk despite layered echo defense; headphones are the reliable configuration. Synthesis is sentence-by-sentence rather than token streaming.
- Installing dsh also installs `sherpa-onnx-node` and its platform-specific native runtime, including ONNX Runtime, even when this bundle is disabled. Runtime installation adds disk and download costs separate from the models downloaded by Download and prepare; the native package size varies by platform and version.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
