/** Reconnecting Host catalog mirrors shared by every voice-conversation UI occurrence. */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SpeechCatalog } from '@deepseek-ai/dsh-experimental-api-speech-to-text/types'
import type { TtsCatalog } from '@deepseek-ai/dsh-experimental-api-text-to-speech/types'

/** Provider catalog plus transport state; a carrier failure never rewrites Host readiness. */
export interface CatalogReadiness<Catalog> {
  readonly catalog: Catalog | null
  readonly connected: boolean
  readonly error: string | null
}

/** Snapshot after one accepted catalog frame. */
function received<Catalog>(catalog: Catalog): CatalogReadiness<Catalog> {
  return { catalog, connected: true, error: null }
}

/** Preserve the last catalog while recording the carrier error. */
function failed<Catalog>(
  previous: CatalogReadiness<Catalog>,
  error: unknown,
): CatalogReadiness<Catalog> {
  return { ...previous, connected: false, error: error instanceof Error ? error.message : String(error) }
}

/**
 * Subscribe once to a Remote follow stream for the whole Client plugin lifetime.
 * @param ctx - mounted Remote owner.
 * @param name - diagnostic stream name.
 * @param open - generated Remote follow method.
 * @returns shared readiness snapshot and joined observation cleanup.
 */
export function observeCatalog<Catalog>(
  ctx: Context,
  name: string,
  open: (signal: AbortSignal) => AsyncIterable<Catalog>,
): { state: SnapshotStore<CatalogReadiness<Catalog>>; dispose: () => Promise<void> } {
  const state = createSnapshotStore<CatalogReadiness<Catalog>>({ catalog: null, connected: false, error: null })
  let disposed = false
  const isDisposed = (): boolean => disposed
  const stream = ctx.remote.$stream<Catalog>({
    name,
    open,
    ended: () => new RemoteStreamCarrierError(`${name} stream ended`),
    carrierFailed: (error: unknown) => { state.set(failed(state.getSnapshot(), error)) },
  })
  const observing = (async () => {
    try {
      for await (const item of stream) {
        state.set(received(item.value))
        item.accept()
      }
    } catch (error) {
      if (!isDisposed()) state.set(failed(state.getSnapshot(), error))
    }
  })()
  return {
    state,
    dispose: async () => {
      disposed = true
      await stream.dispose()
      await observing
    },
  }
}

/** Speech-to-text catalog readiness. */
export type SpeechReadiness = CatalogReadiness<SpeechCatalog>
/** Text-to-speech catalog readiness. */
export type TtsReadiness = CatalogReadiness<TtsCatalog>
