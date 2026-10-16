/** Authenticated loopback transport for one serial native synthesizer. */
import { createServer, type Server } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { SynthesisInputError } from './input.ts'
import type { SynthesizedSpeech } from './inference.ts'

const requestSchema = z.object({ text: z.string(), voiceId: z.string().min(1) }).strict()

/**
 * Bind an ephemeral loopback listener; model loading completes before readiness is published.
 * @param token - private per-process authentication secret.
 * @param maxTextChars - configured request text limit.
 * @param synthesize - synchronous inference owned by this process.
 * @returns the listening server and its dynamically assigned port.
 */
export async function startSynthesisServer(token: string, maxTextChars: number,
  synthesize: (text: string, voiceId: string) => SynthesizedSpeech): Promise<{ server: Server; port: number }> {
  const expected = Buffer.from(`Bearer ${token}`)
  const maxBodyBytes = maxTextChars * 4 + 4096
  const server = createServer((request, response) => {
    const reply = (status: number, value: object): void => {
      response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
    }
    /* jscpd:ignore-start -- bearer gate and route guard are the recognition worker loopback protocol */
    const authorization = Buffer.from(request.headers.authorization ?? '')
    if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
      request.resume(); reply(401, { error: 'Unauthorized' }); return
    }
    const url = new URL(request.url as string, 'http://localhost')
    if (request.method !== 'POST' || url.pathname !== '/synthesize') {
      request.resume(); reply(404, { error: 'Unknown endpoint' }); return
    }
    /* jscpd:ignore-end */
    const length = Number(request.headers['content-length'])
    if (!Number.isSafeInteger(length) || length < 2 || length > maxBodyBytes) {
      request.resume(); reply(413, { error: 'Invalid synthesis request size', code: 'invalid-input' }); return
    }
    /* jscpd:ignore-start -- request collection, binary success frame and error mapping mirror the recognition worker */
    void (async () => {
      try {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(chunk as Buffer)
        const body = Buffer.concat(chunks)
        if (body.length > maxBodyBytes) throw new SynthesisInputError('Synthesis request exceeded its byte limit')
        const parsed = requestSchema.parse(JSON.parse(body.toString('utf8')))
        const result = synthesize(parsed.text, parsed.voiceId)
        response.writeHead(200, {
          'content-type': 'audio/wav',
          'x-dsh-sample-rate': String(result.sampleRate),
          'x-dsh-audio-seconds': String(result.audioSeconds),
          'x-dsh-synthesis-seconds': String(result.synthesisSeconds),
        }).end(result.audio)
      } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
          reply(400, { error: 'Invalid synthesis request', code: 'invalid-input' })
          return
        }
        reply(error instanceof SynthesisInputError ? 400 : 500, {
          error: error instanceof Error ? error.message : String(error),
          ...error instanceof SynthesisInputError ? { code: 'invalid-input' } : {},
        })
      }
    })()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address() as { port: number }
  return { server, port: address.port }
}
/* jscpd:ignore-end */
