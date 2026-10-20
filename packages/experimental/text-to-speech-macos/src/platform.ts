/** macOS-only activation gate for the system speech synthesizer. */

/**
 * Reject activation outside macOS.
 * @param platform - Node platform identifier; defaults to the current process.
 */
export function assertDarwinHost(platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'darwin') throw new Error(`macOS system speech requires the darwin platform, found ${platform}`)
}
