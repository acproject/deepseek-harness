/** Deterministic cached image versions for model requests. */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Sharp } from 'sharp'
import { AttachmentError, ImageVariantId } from '@deepseek-ai/dsh-attachment'
import type {
  ImageMediaType,
  ImageAttachmentRef,
  ImageRequestTarget,
  RequestImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import {
  FLATTEN_BACKGROUND,
  IMAGE_ENCODING_QUALITIES,
  PNG_COMPRESSION_LEVEL,
  WEBP_ENCODING_EFFORT,
  encodeFirstWithinLimit,
  requestEncodingLadder,
  isExhaustedEncoding,
} from './encoding.ts'
import { detectImage, encodedAlphaIsCompatible, probeImage } from './image.ts'
import { requireSharp } from './sharp.ts'

/** Transform version included in every cache and upload-index identity. */
export const REQUEST_IMAGE_TRANSFORM_VERSION = 'request-image-v7'

/** Encoded output media types the request ladder can produce. */
const ENCODABLE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

interface EncodedRequestImage {
  data: Uint8Array
  mediaType: ImageMediaType
  width: number
  height: number
}

interface VerifiedRequestImage extends EncodedRequestImage {
  hasAlpha: boolean
}

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function checkedInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AttachmentError(`${name} must be a positive integer.`, 'INVALID_ATTACHMENT_REF')
  }
  return value
}

function validateTarget(target: ImageRequestTarget): void {
  checkedInteger(target.width, 'Image request width')
  checkedInteger(target.height, 'Image request height')
  checkedInteger(target.maxBytes, 'Image request maxBytes')
  const { mediaTypes } = target
  if (mediaTypes === undefined) return
  if (mediaTypes.length === 0) {
    throw new AttachmentError('Image request mediaTypes must name at least one media type.', 'INVALID_ATTACHMENT_REF')
  }
  for (const mediaType of mediaTypes) {
    if (!(ENCODABLE_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
      throw new AttachmentError(`Image request media type ${mediaType} is not encodable.`, 'INVALID_ATTACHMENT_REF')
    }
  }
}

function descriptor(attachment: ImageAttachmentRef, target: ImageRequestTarget): string {
  return JSON.stringify({
    transformVersion: REQUEST_IMAGE_TRANSFORM_VERSION,
    attachmentId: attachment.attachmentId,
    targetWidth: target.width,
    targetHeight: target.height,
    encodedByteBudget: target.maxBytes,
    encoding: {
      allowedMediaTypes: target.mediaTypes === undefined ? null : [...target.mediaTypes].sort(),
      pngCompressionLevel: PNG_COMPRESSION_LEVEL,
      webpQualities: IMAGE_ENCODING_QUALITIES,
      webpEffort: WEBP_ENCODING_EFFORT,
      jpegQualities: IMAGE_ENCODING_QUALITIES,
      flattenBackground: FLATTEN_BACKGROUND,
      colourspace: 'srgb',
    },
  })
}

/**
 * Complete deterministic identity for one attachment and route-chosen request target.
 * @param attachment - provider-independent durable normalized attachment reference.
 * @param target - route-chosen dimensions and byte target.
 * @returns branded digest over every request transform input.
 */
export function requestImageVariantId(
  attachment: ImageAttachmentRef,
  target: ImageRequestTarget,
): ReturnType<typeof ImageVariantId> {
  return ImageVariantId(`sha256:${digest(descriptor(attachment, target))}`)
}

/** Resize by the source long edge only, so the encoder derives the short edge as the route predicts. */
function pipeline(attachment: StoredImageAttachment, target: ImageRequestTarget): Sharp {
  const byWidth = attachment.ref.width >= attachment.ref.height
  return sourcePipeline(attachment)
    .resize({ ...byWidth ? { width: target.width } : { height: target.height }, withoutEnlargement: true })
}

function sourcePipeline(attachment: StoredImageAttachment): Sharp {
  const sharp = requireSharp()
  return sharp(attachment.data, { failOn: 'error', limitInputPixels: false }).toColourspace('srgb')
}

async function createRequestImage(
  attachment: StoredImageAttachment,
  target: ImageRequestTarget,
  hasAlpha: boolean,
): Promise<EncodedRequestImage> {
  const encodedVersion = await encodeFirstWithinLimit(
    requestEncodingLadder(pipeline(attachment, target), hasAlpha, target.mediaTypes),
    target.maxBytes,
  )
  return isExhaustedEncoding(encodedVersion) ? encodedVersion.smallest : encodedVersion
}

/**
 * Whether the ladder for this target may emit an opaque JPEG for an alpha
 * source: only the flatten-JPEG fallback drops alpha, and it exists exactly
 * when WebP is excluded while JPEG is allowed.
 */
function alphaMayDrop(target: ImageRequestTarget, sourceHasAlpha: boolean): boolean {
  return sourceHasAlpha
    && target.mediaTypes !== undefined
    && !target.mediaTypes.includes('image/webp')
    && target.mediaTypes.includes('image/jpeg')
}

function cachePath(root: string, hash: string): string {
  return join(root, 'request-images', hash.slice(0, 2), hash)
}

async function readCached(
  path: string,
  target: ImageRequestTarget,
  expectedAlpha: boolean,
  signal?: AbortSignal,
): Promise<VerifiedRequestImage | undefined> {
  try {
    const data = new Uint8Array(await readFile(path, { signal }))
    const detected = await probeImage(data)
    if (detected.depth !== 'uchar' || detected.space !== 'srgb'
      || detected.width > target.width || detected.height > target.height
      || (target.mediaTypes !== undefined && !target.mediaTypes.includes(detected.mediaType))
      || !encodedAlphaIsCompatible(expectedAlpha, detected, alphaMayDrop(target, expectedAlpha))) return undefined
    return { data, mediaType: detected.mediaType, width: detected.width, height: detected.height, hasAlpha: detected.hasAlpha }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return undefined
    signal?.throwIfAborted()
    return undefined
  }
}

async function verifyRequestImage(
  image: EncodedRequestImage,
  expectedAlpha: boolean,
  allowAlphaDrop: boolean,
): Promise<VerifiedRequestImage> {
  const detected = await detectImage(image.data)
  if (detected.depth !== 'uchar' || detected.space !== 'srgb'
    || detected.width !== image.width || detected.height !== image.height
    || detected.mediaType !== image.mediaType
    || !encodedAlphaIsCompatible(expectedAlpha, detected, allowAlphaDrop)) {
    throw new AttachmentError(
      'Encoded model-request image does not match its verified 8-bit sRGB metadata.',
      'ATTACHMENT_WRITE_FAILED',
    )
  }
  return { ...image, hasAlpha: detected.hasAlpha }
}

async function writeCached(path: string, data: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, data, { mode: 0o600, flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

/**
 * Generate or reuse one request image below the local attachment cache root.
 * @param root - absolute attachment cache root; variants use its `request-images` child.
 * @param attachment - verified normalized attachment bytes and reference.
 * @param target - exact route-chosen dimensions and byte target; a target above the source keeps the source size.
 * @param signal - optional cancellation for cache I/O and image transformation.
 * @returns verified request bytes and deterministic variant identity.
 */
export async function readRequestImageFile(
  root: string,
  attachment: StoredImageAttachment,
  target: ImageRequestTarget,
  signal?: AbortSignal,
): Promise<RequestImageAttachment> {
  signal?.throwIfAborted()
  validateTarget(target)
  const source = await probeImage(attachment.data)
  const variantId = requestImageVariantId(attachment.ref, target)
  const hash = String(variantId).slice('sha256:'.length)
  const path = cachePath(root, hash)
  const cached = await readCached(path, target, source.hasAlpha, signal)
  const created = cached ?? await createRequestImage(attachment, target, source.hasAlpha)
  const version = cached ?? await verifyRequestImage(created, source.hasAlpha, alphaMayDrop(target, source.hasAlpha))
  signal?.throwIfAborted()
  if (cached === undefined) await writeCached(path, version.data)
  return {
    variantId,
    attachment: attachment.ref,
    data: version.data,
    mediaType: version.mediaType,
    bytes: version.data.byteLength,
    width: version.width,
    height: version.height,
    depth: 'uchar',
    space: 'srgb',
    hasAlpha: version.hasAlpha,
  }
}
