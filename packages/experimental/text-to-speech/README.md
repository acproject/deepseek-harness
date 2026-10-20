---
description: "Named experimental speech synthesis providers, voice selection, and cancellation ownership."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-text-to-speech

English | [中文](README.zh.md)

## Summary

This Service Definition selects named speech synthesizers through `ctx.textToSpeech`. Consumers resolve their request before execution; providers register independently and each provider advertises its own voices.

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

Load through the [voice conversation bundle](../voice-conversation-bundle/README.md), or compose the service with a provider and consumer. `defaultProvider` and `defaultVoice` are required and select an exact registered provider and voice; the bundle supplies `macos-say` with `Tingting (中文（中国大陆）)` on darwin and `kokoro-local` with `zf_xiaobei` elsewhere. `language` supplies the omitted language hint. A missing or duplicate provider, an unknown voice, or an unsupported language fails explicitly.

Providers advertise preparation origins through `downloadSources`. `prepare(id, options)` forwards an optional `downloadSource` for one task; the provider validates the choice and refuses source changes during active preparation. Omission retains provider policy. Source choices are not persisted synthesis preferences.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`resolve()` captures the provider instance, text, voice and language. `synthesize()` rejects a withdrawn or replaced registration. A registration disposer closes admission, aborts accepted requests and joins provider settlement; providers must honor cancellation. No fallback selects a different synthesizer or sends text elsewhere.

`defaultProvider`, `defaultVoice` and `language` are volatile Config fields: `configure()` writes the supplied fields into this plugin's profile entry through the `settings` service, and the running instance reads the updated values without remounting; composition defaults apply until an override is saved. Settings addresses the entry by its configured id (`entry.options.id`), without the Loader's Include path. `configure()` fails without `settings` or a profile entry, and rejects an unknown voice or a language unsupported by the selected voice before saving. Provider-owned preparation reuses the speech recognition preparation state vocabulary through complete `SynthesisSnapshot` values; closing an observer never cancels preparation.

Synthesis results are canonical mono PCM16 WAV bytes with their sample rate. The service neither plays nor streams audio; consumers own playback.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Voice conversation subsystem](../../../docs/subsystems/voice-conversation.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as synthesis consumes completed assistant or client text and never enters model requests.

#### KV Cache effect

No effect; synthesis stays outside the model conversation.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only complete-text one-shot synthesis is supported. Streaming token-to-speech, voice cloning and cloud providers have no service methods.
- Preparation state types are shared with speech recognition and carry its vocabulary, including the unused `vad` step kind.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
