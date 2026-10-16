# Agent Note: Experimental always-on voice conversation with local synthesis

Status: implemented

English | [中文](2026-10-15-experimental-voice-conversation.zh.md)

## Problem

The voice input bundle stops at a reviewed transcript. A conversational voice mode needs the reverse path: the assistant's answer must become speech, playback must coexist with an open microphone, and the user must be able to interrupt. Running recognition and playback in one open-air loop risks self-triggering, and a second ASR stack would duplicate the already shipped SenseVoice seam.

## Decision

Three new packages plus one bundle compose the feature, all under `packages/experimental/` and default-disabled: the `text-to-speech` Service Definition, the `text-to-speech-kokoro` provider, the `api-text-to-speech` Remote, and the `client-ui-voice-conversation` browser loop. The `voice-conversation-bundle` patch mounts seven rows: both services, both local providers, both Remotes and one browser contribution. The push-to-talk voice input plugin is deliberately not mounted; the browser loop imports only the pure `./audio` WAV-encoding subpath of that package, and recognition reuses the existing service, Remote and SenseVoice contracts unchanged. The frozen scope excludes a local Qwen adapter, mobile/WebRTC companions and an idea-graph brainstorm service; this note covers the voice question-answer loop only.

Kokoro multilingual v1_0 through sherpa-onnx `OfflineTts` is the first synthesizer: one int8 archive, 24 kHz mono WAV, Chinese and English voices, `zf_xiaobei` as the bundle default voice with language `auto`. Synthesis is sentence-by-sentence and non-streaming. The assistant speech feed consumes only appended durable assistant content and transient deltas above the subscription baseline, deduplicates revisions, emits complete sentences and one settlement-tail fragment, and the provider is configured for one sentence per call so a sentence is the smallest interruptible unit. Per-sentence jobs abort independently; the keyed playback FIFO is drained on new turns and on interrupted attempt settlements.

Echo defense is five layers: browser acoustic echo cancellation, noise suppression and automatic gain on the microphone track; playback-aware onset thresholds (a much higher, briefly confirmed barge-in level) with best-effort headphone detection that downgrades to a loudspeaker warning; the energy VAD with calibrated noise floor and barge-pending confirmation; a normalized-text echo guard that rejects transcripts equal to recently spoken text within a TTL; and the turn rule that cancels the running agent turn before a barge-in utterance is sent. No single layer is treated as sufficient; the package README keeps open-air loudspeaker use listed as residual risk and recommends headphones.

Capture resamples the microphone to 16 kHz mono via AudioWorklet with a ScriptProcessor fallback, keeps 250 ms of pre-roll and pads closing silence, so one VAD implementation serves recognition without a second native component. One controller per Session is created through the sessions binding and disposed with the slot; two catalog `follow()` mirrors are shared plugin-wide via one stream each and never rewritten by carrier failures. The session event source is shared with the binding owner; the controller adds no second event subscription path. Audio frames and transcripts write no Session event, so model-visible text remains the ordinary submitted message and the Session log reconstructs every model input.

## Alternatives considered

A streaming TTS provider would reduce first-audio latency but requires token-level audio framing, incremental playback cancellation and partial-text revision semantics that the sentence feed and current providers do not have; sentence synthesis is the smallest complete unit. A second browser ASR stack or a cloud recognizer would duplicate the provider seam or silently change where speech is processed. Browser-native speech recognition offers no uniform local-processing guarantee. Wake words, always-on cloud transport and full-duplex WebRTC to a mobile companion were explicitly out of scope. Reusing the voice input plugin itself would have coupled the always-on loop to push-to-talk UI lifecycle, so only its stateless WAV encoder is imported.

## Consequences

First use downloads two local models (SenseVoice and Kokoro) through the existing preparation vocabulary; synthesis preparation aliases the speech preparation state types instead of inventing a parallel state machine. Local still means the Host machine. Non-streaming sentence playback has visible inter-sentence latency under load; this is accepted for the experimental scope and documented in the package limitations.

Verification covers sentence splitting and feed settlement, VAD calibration/barge-in transitions, echo rejection, barge-in ordering, per-Session controller lifecycle, and Remote failure containment with injected capture/playback fakes, plus mount composition and client component tests. The Kokoro provider has real-inference e2e tests with relaxed byte equality. Client bundle purity is gated; only declared injected packages cross the bundle boundary. Windows, Linux and signed-installer acceptance for the native runtime still follows the voice input policy.
