---
description: "Synthesize speech on macOS through the built-in say command."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-text-to-speech-macos

English | [中文](README.zh.md)

## Summary

This provider synthesizes speech by running the macOS built-in `say` command on the Host. There is no model download, extraction or preparation: activation lists the installed system voices, registers them, and the provider is ready immediately. Voice quality follows whatever system voices the machine has installed, including the enhanced Chinese voices such as Tingting.

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

The [bundle](../voice-conversation-bundle/README.md) enables this plugin on darwin and selects `macos-say` with the Tingting voice as the default; on other platforms the plugin stays disabled and Kokoro remains the default. The voice UI can switch between this provider and Kokoro at any time, and every installed system voice appears with its catalog name.

Configuration covers deployment-varying choices: `command` overrides the executable path, `locales` filters the catalog by primary locale subtag (default `zh` and `en`), `rateWpm` sets a words-per-minute speaking rate or leaves each voice's native rate, and `sampleRate` requests the output rate (default 24000 hertz). `maxTextChars` bounds request text, `maxAudioBytes` bounds produced audio, and `voiceListTimeoutMs` and `synthesisTimeoutMs` bound the two subprocess phases. Text stays within the default 500 code points, matching the Kokoro provider's contract.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

Every synthesis spawns one fresh `say` process and removes its temporary WAV file on every exit path. This differs from the Kokoro provider's resident worker on purpose: `say` has no model loading, so a per-request process adds only process startup, keeps no shared state to cancel or recycle, and lets the subprocess service own each process range. Request text travels on standard input through `-f -`, because `say` has no end-of-options marker and stdin delivery keeps text from ever being interpreted as command-line options. The output file is validated as RIFF/WAVE: the format chunk must be mono PCM16 at the configured sample rate, unknown chunks such as `FLLR` are skipped by their declared size, and stereo or non-PCM output is rejected rather than downmixed. Voice ids are the exact CLI names from `say -v '?'`, so Chinese voices that also read embedded English advertise `auto`, `zh` and `en`, following the Kokoro language convention. A missing or unfilterable catalog fails activation loudly; there is no preparation phase and the registry reports the provider ready.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Text-to-speech service](../text-to-speech/README.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as synthesis requests remain outside model requests; the ordinary assistant turn owns the spoken text.

#### KV Cache effect

No direct effect; ordinary turn generation owns the message content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Darwin only; the plugin is disabled elsewhere and the bundle keeps Kokoro as the default on other platforms. The catalog follows the voices installed on the machine, so a voice id selected on one host may be absent on another; the voice UI lists whatever the current host provides. Voices that ignore `--data-format` or `--channels` fail the WAV validation loudly instead of producing mismatched audio. There is no `maxPending` cap, unlike Kokoro: each request owns its process, so concurrent requests do not queue behind a shared worker and the operating system owns process scheduling. Chinese voices read embedded English with an accent under the `auto` language; switching the language hint in the UI selects a dedicated English voice instead. `rateWpm` applies to every voice uniformly, and a future Windows system-speech provider is deferred.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

The real `say` test is opt-in on a darwin host: set `DSH_TTS_MACOS_E2E=1`, then run the package `local.e2e.ts` through the e2e Vitest configuration.

</details>
