---
description: "Prepare and operate a local CPU Kokoro speech synthesis worker on demand."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-text-to-speech-kokoro

English | [中文](README.zh.md)

## Summary

This provider synthesizes speech with the Kokoro multi-language v1_0 ONNX model through sherpa-onnx OfflineTts on the Host CPU. The platform-specific sherpa-onnx Node package includes ONNX Runtime; users need no Python, compiler or model conversion. It ships 53 named voices covering Chinese and English. Activation checks cached resources without loading models or downloading assets.

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

The [bundle](../voice-conversation-bundle/README.md) supplies an absolute `dataRoot` under the DSH home. Preparation downloads one revision-pinned archive, verifies its size and SHA-256 hash, extracts it with the platform tar into the managed models directory, verifies the pinned model files, then loads them. `precision` defaults to `int8`; `fp32` selects the larger reference weights. `modelDirectory` supplies an existing absolute directory containing the selected ONNX model, `voices.bin`, `tokens.txt`, both lexicons and `espeak-ng-data`; manual directories bypass downloads and remain the deployer's responsibility. Verified completed files remain reusable after cancellation or failure.

Before the archive is downloaded, the Host compares the configured `modelOrigins`, which default to `https://github.com`; mirror deployments override this list. Concurrent HEAD requests follow the pinned release path and redirects through the Host's fetch proxy; the first 2xx response is tried first. `modelProbeTimeoutMs` defaults to 3000 ms; when every probe fails, downloads use the configured order. Network, HTTP, certificate and integrity failures try the remaining sources; cancellation, extraction failures, storage failures and unclassified failures stop preparation. Pinned revisions, sizes and SHA-256 hashes apply to every source. Response latency does not measure download throughput; the preparation deadline still bounds the complete download.

An explicit `modelOrigin` uses only that origin, without probing or public fallback. A single-entry `modelOrigins` also skips probing. Verified caches and explicit offline paths require no source requests. The voice UI offers the advertised sources before preparation or retry. A manual choice overrides selection for that task only, uses one source without fallback, and cannot replace an active task’s source. The Host rejects choices outside its configured origins; fully offline deployments advertise no download sources.

Download failures identify the archive and source origin, with a classified cause and HTTP status or diagnostic code when available. The public state omits URL credentials, query strings and raw cause messages. Retry reuses a verified archive and verified model files; partial downloads restart. A complete extraction whose stamp is missing but whose pinned files match is re-stamped without downloading again.

Every activation checks the selected model, voice table, tokens, lexicons and espeak data on disk. Complete verified caches restore readiness immediately after inspection; the first synthesis wakes the worker. Missing files or mismatched managed checksums require explicit preparation, while unreadable paths report an error. Disabling the plugin or restarting the Host does not require downloading intact caches again.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

One managed Node subprocess serializes inference. Requests submitted during wake-up join the bounded queue. At execution, the worker requires ready or standby resources. Synthesis never starts preparation downloads. `threads` tunes CPU inference; `speed` scales the speaking rate; `maxPending` bounds accepted work. Preparation and synthesis have separate deadlines. Empty or over-long text and unknown voices are rejected before native inference and retain the loaded worker; inference failures, malformed responses and transport failures reclaim it. Cancellation terminates an active worker and joins its process range; cancelled queued requests never run. `idleTimeoutMs` releases the worker after inactivity, with zero retaining it until disposal. Models remain cached. The worker returns one complete mono 24 kHz 16-bit PCM WAV per request; audio is not streamed. Authenticated loopback requests keep audio in memory. Electron workers run in Node mode.

The Host owns preparation across page and Session changes: check resources, download the archive, extract, verify files, and load the worker. Explicit model paths omit download and extraction steps. Downloads report bytes; other steps report elapsed time. An idle worker retains prepared paths and needs only model loading on wake-up. Cancellation after a preparation result is published waits for cleanup without replacing that result.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

[Text-to-speech service](../text-to-speech/README.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as synthesis requests and preparation remain outside model requests; the ordinary assistant turn owns the spoken text.

#### KV Cache effect

No direct effect; ordinary turn generation owns the message content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- CPU only. Native packages target macOS arm64/x64, Linux glibc arm64/x64 and Windows x64; Windows ARM64 and Linux musl are not verified deployment targets. The extracted INT8 model occupies about 190 MB and FP32 about 390 MB; the verified archive is also retained until replaced, so the UI estimates recommend 600 MB and 1.2 GB of disk. Synthesis is sentence-oriented and non-streaming: the complete WAV returns after generation finishes, and `maxTextChars` defaults to 500 code points. One serial worker serves one synthesis at a time; concurrent requests queue up to `maxPending`. The Kokoro voice table exposes 53 named speakers (identifiers `af_*` through `zm_yunyang`); the native runtime reports 54 speaker slots and the final slot has no published voice. The unused jieba `dict/` directory is not configured; Chinese normalization uses the bundled number, date and phone FSTs. Headphones are recommended for always-listening voice conversation on open speakers; residual echo handling belongs to the conversation client, not this provider. Disabling the plugin retains model caches. Packaged Desktop releases still require platform signing and audio-permission acceptance; Linux Desktop distribution is outside this provider.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

The optional real-model test is opt-in: set `DSH_TTS_E2E_ROOT` to an empty data directory (and optionally `DSH_TTS_E2E_MODEL` to a verified extraction and `DSH_TTS_E2E_PRECISION=fp32`), then run the package `local.e2e.ts` through the e2e Vitest configuration.

</details>
