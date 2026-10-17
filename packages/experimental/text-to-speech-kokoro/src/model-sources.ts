/** Host-side response comparison for pinned archives on configured release origins. */
import { deadline } from '@deepseek-ai/dsh-timeout'

/**
 * Prefer the first successful HEAD response while retaining other sources for download fallback.
 * All probes settle before returning; if every probe fails, the configured order is preserved.
 * @param assetUrl - pinned upstream archive URL.
 * @param origins - nonempty configured origins, or one explicit deployment origin.
 * @param timeoutMs - maximum probe duration, including redirects.
 * @param signal - preparation cancellation or deadline.
 * @returns deduplicated download URLs with the first responding source first; a single source needs no probe.
 */
/**
 * Build a concrete download URL for one origin.
 * Origins ending in "/" are treated as prefixes (for reverse-proxy accelerators like gh-proxy),
 * where the full assetUrl is appended. Other origins replace the asset URL's origin (Hugging Face mirrors,
 * direct GitHub access).
 */
function constructUrl(assetUrl: string, origin: string): string {
  if (origin.endsWith('/')) return origin + assetUrl
  return new URL(new URL(assetUrl).pathname, origin).href
}

export async function orderModelSources(assetUrl: string, origins: readonly string[], timeoutMs: number,
  signal: AbortSignal): Promise<string[]> {
  /* jscpd:ignore-start -- origin probing follows the speech recognition model-source contract */
  signal.throwIfAborted()
  const urls = [...new Set(origins.map(origin => constructUrl(assetUrl, origin)))]
  if (urls.length === 1) return urls
  const finished = new AbortController()
  using timeout = deadline(signal, timeoutMs, 'TTS_SOURCE_PROBE_TIMEOUT')
  const probing = AbortSignal.any([timeout.signal, finished.signal])
  const requests = urls.map(async url => ({ url, response: await fetch(url, { method: 'HEAD', signal: probing }) }))
  let preferred: string | undefined
  try {
    preferred = await Promise.any(requests.map(async (request) => {
      const { url, response } = await request
      if (!response.ok) throw new Error(`Model source probe returned HTTP ${response.status}`)
      return url
    }))
  } catch (_unavailableSources) {
    // Downloads can still work when an origin refuses HEAD or exceeds the probe deadline.
  } finally {
    finished.abort()
    const settled = await Promise.allSettled(requests)
    await Promise.allSettled(settled.map(async (result) => {
      if (result.status === 'fulfilled') await result.value.response.body?.cancel()
    }))
  }
  signal.throwIfAborted()
  return preferred === undefined ? urls : [preferred, ...urls.filter(url => url !== preferred)]
  /* jscpd:ignore-end */
}
