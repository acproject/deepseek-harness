---
description: "Expose bounded transient synthesis through the authenticated Web Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-api-text-to-speech

English | [中文](README.zh.md)

## Summary

The `tts` Remote connects browser voice clients to `ctx.textToSpeech`. It exposes provider and voice discovery and one complete-text synthesis call.

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

Compose with the synthesis Service Definition and Typert. `maxTextChars` and `maxAudioBytes` limit accepted text and returned audio. The browser UI mounts this package’s generated `/remote` contribution when enabled.

`prepare(providerId, { downloadSource })` forwards one advertised source to the provider; omission keeps its configured policy. The catalog carries `downloadSources` for the picker. The provider rejects unavailable choices and changes to an active task’s source.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`catalog()` exposes provider and voice identities, the default selection and intake limits. `synthesize()` rejects empty or over-long text, measured in Unicode code points, before resolving the selected provider, and rejects audio above the configured byte limit. The existing gateway owns authentication and cancellation transport. Audio is transient, never a Session event or attachment; the ordinary assistant turn owns the spoken text.

`follow()` streams complete catalogs, including preparation states and current preferences. `prepare()` starts or joins a Host task; `cancelPreparation()` explicitly cancels it. `configure()` persists the supplied preference fields. A disconnected observer does not cancel preparation.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Local Kokoro provider](../text-to-speech-kokoro/README.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as synthesis requests and preparation remain outside model requests; the ordinary assistant turn owns the spoken text.

#### KV Cache effect

No direct effect; ordinary turn generation owns the message content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- No persistent audio history or streaming protocol is exposed; each call returns one complete WAV. Base64 adds transport overhead; text and audio remain bounded by the advertised limits.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
