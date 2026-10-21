/** Shared quality ladder and lazy candidate execution for normalization and request-image encoders. */

import type { Sharp } from 'sharp'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

/** Shared ladder for both encoders: spaced so each step buys a real size reduction. */
export const IMAGE_ENCODING_QUALITIES = [85, 75, 60] as const
/** Fixed lossy-WebP effort; deeper search costs 3-4x encode time for about 5% size. */
export const WEBP_ENCODING_EFFORT = 0
/** Fixed PNG zlib compression level for request images; 6 is the sharp default. */
export const PNG_COMPRESSION_LEVEL = 6
/** Background an alpha source flattens onto for lossy JPEG request variants. */
export const FLATTEN_BACKGROUND = { r: 255, g: 255, b: 255 }

/** One ladder output carrying its complete bytes and exact facts. */
export interface EncodedImage {
  data: Uint8Array
  mediaType: 'image/jpeg' | 'image/webp' | 'image/png'
  width: number
  height: number
}

async function encode(pipeline: Sharp, mediaType: 'image/jpeg' | 'image/webp', quality: number): Promise<EncodedImage> {
  const encoded = mediaType === 'image/webp'
    ? pipeline.webp({ quality, effort: WEBP_ENCODING_EFFORT })
    : pipeline.jpeg({ quality })
  const { data, info } = await encoded.toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data), mediaType, width: info.width, height: info.height }
}

async function encodePng(pipeline: Sharp): Promise<EncodedImage> {
  const { data, info } = await pipeline
    .png({ compressionLevel: PNG_COMPRESSION_LEVEL })
    .toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data), mediaType: 'image/png', width: info.width, height: info.height }
}

/**
 * Build the lazy quality ladder for one prepared pipeline: WebP keeps a source
 * alpha channel, everything else is JPEG.
 * @param prepared - sized sRGB pipeline; cloned per candidate.
 * @param hasAlpha - decoded source alpha fact selecting the codec.
 * @returns encoders ordered from highest to lowest ladder quality.
 */
export function encodingLadder(prepared: Sharp, hasAlpha: boolean): Array<() => Promise<EncodedImage>> {
  const mediaType = hasAlpha ? 'image/webp' : 'image/jpeg'
  return IMAGE_ENCODING_QUALITIES.map(quality => (
    () => encode(prepared.clone(), mediaType, quality)
  ))
}

/**
 * Build the lazy request-image ladder for one prepared pipeline under a
 * media-type constraint: PNG first (lossless, alpha-preserving, decodable by
 * every backend), then lossy fallbacks — WebP for an alpha source while WebP
 * is allowed, because WebP preserves alpha; JPEG for an opaque source. When
 * WebP is excluded, an alpha source falls to JPEG flattened onto
 * {@link FLATTEN_BACKGROUND}. Omission of `mediaTypes` allows every codec.
 * @param prepared - sized sRGB pipeline; cloned per candidate.
 * @param hasAlpha - decoded source alpha fact selecting the lossy fallback.
 * @param mediaTypes - allowed encoded output media types; undefined allows all.
 * @returns encoders ordered from preferred to smallest fallback.
 */
export function requestEncodingLadder(
  prepared: Sharp,
  hasAlpha: boolean,
  mediaTypes: readonly ImageMediaType[] | undefined,
): Array<() => Promise<EncodedImage>> {
  const allows = (mediaType: 'image/png' | 'image/jpeg' | 'image/webp'): boolean =>
    mediaTypes === undefined || mediaTypes.includes(mediaType)
  const candidates: Array<() => Promise<EncodedImage>> = []
  if (allows('image/png')) candidates.push(() => encodePng(prepared.clone()))
  if (hasAlpha) {
    if (allows('image/webp')) {
      candidates.push(...encodingLadder(prepared, true))
    } else if (allows('image/jpeg')) {
      candidates.push(...IMAGE_ENCODING_QUALITIES.map(quality => () => encode(
        prepared.clone().flatten({ background: FLATTEN_BACKGROUND }),
        'image/jpeg',
        quality,
      )))
    }
  } else if (allows('image/jpeg')) {
    candidates.push(...encodingLadder(prepared, false))
  } else if (allows('image/webp')) {
    candidates.push(...encodingLadder(prepared, true))
  }
  return candidates
}

/** One encoded candidate carrying its complete bytes. */
export interface EncodedCandidate {
  data: Uint8Array
}

/** Result of exhausting candidates at one raster size without a fitting output. */
export interface ExhaustedEncoding<T extends EncodedCandidate> {
  smallest: T
}

/**
 * Execute encoding candidates in preference order and stop after the first fitting output.
 * @param attempts - lazy encoders ordered from preferred to fallback representation.
 * @param maxBytes - positive encoded-byte target.
 * @returns the first fitting candidate, otherwise the smallest completed fallback.
 */
export async function encodeFirstWithinLimit<T extends EncodedCandidate>(
  attempts: readonly (() => Promise<T>)[],
  maxBytes: number,
): Promise<T | ExhaustedEncoding<T>> {
  const [first, ...remaining] = attempts
  if (first === undefined) throw new Error('image encoding requires at least one candidate')
  let smallest = await first()
  if (smallest.data.byteLength <= maxBytes) return smallest
  for (const attempt of remaining) {
    const candidate = await attempt()
    if (candidate.data.byteLength <= maxBytes) return candidate
    if (candidate.data.byteLength < smallest.data.byteLength) {
      smallest = candidate
    }
  }
  return { smallest }
}

/**
 * Whether a lazy encoding result exhausted every candidate at one size.
 * @param result - first fitting candidate or exhausted result.
 * @returns whether every candidate exceeded the byte target.
 */
export function isExhaustedEncoding<T extends EncodedCandidate>(
  result: T | ExhaustedEncoding<T>,
): result is ExhaustedEncoding<T> {
  return 'smallest' in result
}
