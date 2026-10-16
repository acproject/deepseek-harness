# Voice conversation

English | [中文](voice-conversation.zh.md)

Experimental voice conversation closes the speech loop: the [synthesis Service Definition](../../packages/experimental/text-to-speech/README.md) routes named text-to-speech providers, the [Kokoro provider](../../packages/experimental/text-to-speech-kokoro/README.md) owns local synthesis, and the [Remote consumer](../../packages/experimental/api-text-to-speech/README.md) serves the browser. The [browser loop](../../packages/experimental/client-ui-voice-conversation/README.md) pairs them with the existing [recognition stack](../../packages/experimental/speech-to-text/README.md) and its [SenseVoice recognizer](../../packages/experimental/speech-to-text-sensevoice/README.md); the [optional bundle](../../packages/experimental/voice-conversation-bundle/README.md) composes all seven plugins. Recognition follows the [voice input](voice-input.md) contracts; this page covers synthesis and the always-on conversation loop.

## Provider selection

`SynthesisProviderId` brands the registration identity. `SynthesisProviderInfo` carries a display name, `host-local` or `cloud` processing location and the selectable `voices`; each `SynthesisVoice` lists accepted `languages` hints, including `auto` for mixed-language text. `SynthesisRequest` contains text and optional provider, voice and language selection; `resolve()` produces a `SynthesisSpec` with one captured provider instance. A missing provider, voice or unsupported language fails; replacement or withdrawal invalidates resolved work. Speech never falls back to a different provider.

`SynthesisProvider.synthesize()` accepts one complete `SynthesisInput` bounded by the caller and an `AbortSignal`. `SynthesisResult` returns canonical mono PCM16 WAV bytes with `sampleRate`, `audioSeconds` and `synthesisSeconds`. Providers honor cancellation and settle their work before deregistration completes. The local provider serializes calls, bounds its queue and manages its worker lifetime independently of Sessions.

## Browser and Host ownership

The browser owns microphone tracks, playback and all interaction timing; the Host owns recognition, synthesis and provider resources. The Remote surface is the only boundary: `TtsCatalog` advertises providers, voices, the default selection and synthesis limits, `SynthesisRequestWire` carries bounded text and selection, and `SynthesizedAudioWire` returns base64 WAV. The API validates this process input and reports `tts/invalid-text` or `tts/synthesis-failed` as typed Remote errors. Utterance recognition reuses `TranscriptionRequest` unchanged.

One controller per Session drives the loop: always-on capture resamples to 16 kHz mono (AudioWorklet with a ScriptProcessor fallback), retains pre-roll, and an energy VAD with calibration, onset and barge-in thresholds closes utterances from end-of-speech silence. Closed utterances are encoded with the shared voice-input WAV encoder, transcribed once, and submitted as ordinary user messages. Assistant text is consumed from the Session event stream: appended durable content and transient deltas above the subscription baseline are split into complete sentences plus one settlement-tail fragment, and each sentence becomes one non-streaming synthesis request played through a keyed FIFO queue.

Echo defense is layered. The microphone track requests browser acoustic echo cancellation, noise suppression and automatic gain; onset while playback is active requires a much higher, briefly confirmed energy level; the normalized-text echo guard discards transcripts equal to recently spoken text; and a new turn or an interrupted attempt aborts pending synthesis, clears the queue and stops playback before the barge-in is sent. Headphone detection downgrades confidence to a loudspeaker warning; open-air use remains residual-risk. Audio frames and transcripts write no Session event; the ordinary submitted message owns model-visible text.

## Preparation and settings

Synthesis reuses the recognition preparation vocabulary: `SynthesisPreparationState`, ordered `SynthesisPreparationStep`s, `SynthesisSetupEstimate`, `downloadSources` and `SynthesisDownloadFailure` are aliases of the shared speech types. The Kokoro provider owns one preparation task across page and Session changes under its own `dshHomePath('text-to-speech', 'kokoro')` cache root. The Client shares one speech and one synthesis `follow()` subscription across the activity, setup prompt and bundle details; carrier failures mark the mirror disconnected without rewriting its last catalog.

The always-on activity occupies `conversation.input.activity` and shares the slot with push-to-talk voice input; the bundle mounts exactly one client contribution. Bundle details occupy `plugins.bundle.config` and `plugins.bundle.activation` keyed by the bundle id, with provider, voice, language and microphone preferences, preparation state and progress. The selected microphone persists in a browser-local key separate from the voice-input plugin. The bundle patch defaults to the `kokoro-local` provider, voice `zf_xiaobei` and language `auto`; recognition defaults to `sensevoice-local`.

## Design rationale

The [voice conversation decision](../../.agents/notes/implemented/architecture/2026-10-15-experimental-voice-conversation.md) records the Kokoro selection, non-streaming sentence pipeline, five-layer echo defense, and the decision to reuse the recognition seam rather than add a second ASR path.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtexttospeech--texttospeech"></a>

### `ctx.textToSpeech` — `TextToSpeech`

Registry shared by all synthesis consumers in one Host composition.

```ts cordis-catalog
/**
 * Register one synthesizer; duplicate ids fail without replacing the original.
 * @param provider - synthesizer owned by the contributing fiber.
 * @returns idempotent disposer which rejects admission, cancels, and joins accepted work.
 */
register(provider: SynthesisProvider): () => Promise<void>

/**
 * Read the current synthesizer roster.
 * @returns available provider facts in registration order.
 */
listProviders(): readonly SynthesisProvider['info'][]

/**
 * Observe complete readiness snapshots; a slow reader coalesces intermediate progress.
 * @param caller - observer lifetime, independent of any preparation task.
 * @returns an initial snapshot followed by the latest provider states.
 */
async *follow(caller: AbortSignal): AsyncIterable<SynthesisSnapshot>

/**
 * Read provider readiness and current user preferences together.
 * @returns one detached complete observation.
 */
snapshot(): SynthesisSnapshot

/**
 * Persist changed selection fields into this plugin's profile entry; the resulting voice and language must be
 * accepted by the selected provider.
 * @param patch - explicit provider, voice or language changes.
 * @returns after the profile write and the live update it applies.
 */
async configure(patch: SynthesisSelectionPatch): Promise<void>

/**
 * Start or join provider-owned preparation.
 * @param id - exact registered provider identity.
 * @param options - task-local source selection validated by the provider.
 */
prepare(id: SynthesisProviderId, options?: SynthesisPreparationOptions): void

/**
 * Explicitly cancel provider preparation without tying it to a browser connection.
 * @param id - exact registered provider identity.
 * @returns after the preparation task settles.
 */
async cancelPreparation(id: SynthesisProviderId): Promise<void>

/**
 * Apply composition defaults and capture the selected provider. Missing providers, voices and unsupported
 * languages fail explicitly.
 * @param request - complete text and optional selection.
 * @returns provider-pinned input for synthesize().
 */
resolve(request: SynthesisRequest): SynthesisSpec

/**
 * Execute exactly the resolved provider; no fallback sends text elsewhere.
 * @param spec - resolved input; a withdrawn or replaced registration is rejected.
 * @param signal - caller cancellation.
 * @returns final audio after provider settlement.
 */
async synthesize(spec: SynthesisSpec, signal: AbortSignal): Promise<SynthesisResult>
```

Source: [`packages/experimental/text-to-speech/src/index.ts`](../../packages/experimental/text-to-speech/src/index.ts)

<a id="ctxttscontroller--ttscontroller"></a>

### `ctx.ttsController` — `TtsController`

Synthesis calls never activate or submit to an Agent.

```ts cordis-catalog
/**
 * Read provider choices without preparing a synthesizer.
 * @returns available providers, resolved default, and intake limits.
 */
@Remote catalog(): TtsCatalog

/**
 * Follow provider readiness independently of Session and preparation lifetimes.
 * @param signal - Client observation lifetime.
 * @returns initial and subsequent complete readiness snapshots.
 */
@Remote({ mode: 'stream' }) async *follow(signal: AbortSignal): AsyncIterable<TtsCatalog>

/**
 * Persist the user's synthesis preferences.
 * @param patch - changed preference fields.
 * @returns after preferences are saved.
 */
@Remote configure(patch: SynthesisSelectionPatch): Promise<void>

/**
 * Start or join one Host-owned preparation task.
 * @param providerId - selected synthesizer.
 * @param options - task-local source selection validated by the provider.
 */
@Remote prepare(providerId: SynthesisProviderId, options?: SynthesisPreparationOptions): void

/**
 * Explicitly cancel resource preparation.
 * @param providerId - selected synthesizer.
 * @returns after the preparation task settles.
 */
@Remote cancelPreparation(providerId: SynthesisProviderId): Promise<void>

/**
 * Validate and synthesize one text through the explicit provider selection.
 * @param request - text, provider id, voice id and language hint.
 * @param signal - Client cancellation or Remote contribution disposal.
 * @returns canonical WAV encoded as base64, without adding a Session event.
 */
@Remote async synthesize(request: SynthesisRequestWire, signal: AbortSignal): Promise<SynthesizedAudioWire>
```

Source: [`packages/experimental/api-text-to-speech/src/index.ts`](../../packages/experimental/api-text-to-speech/src/index.ts)
<!-- END GENERATED cordis-surface -->
