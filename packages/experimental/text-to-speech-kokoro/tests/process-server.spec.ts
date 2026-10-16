/** Loopback authentication, request bounds and WAV responses of the private synthesis server. */
import { connect } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { startSynthesisServer } from '../src/process-server.ts'
import { SynthesisInputError } from '../src/input.ts'
import { encodeWav, type SynthesizedSpeech } from '../src/inference.ts'

let server: Server | undefined
const token = 'a'.repeat(64)
const speech: SynthesizedSpeech = {
  audio: encodeWav(Float32Array.from([0, 0.1, -0.1, 0]), 24000),
  sampleRate: 24000, audioSeconds: 4 / 24000, synthesisSeconds: 0.25,
}

async function listen(handler: (text: string, voiceId: string) => SynthesizedSpeech): Promise<string> {
  const started = await startSynthesisServer(token, 100, handler)
  server = started.server
  return `http://127.0.0.1:${started.port}`
}

async function post(url: string, body: string, authorization = `Bearer ${token}`): Promise<Response> {
  return await fetch(`${url}/synthesize`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body,
  })
}

afterEach(async () => {
  const active = server
  if (active === undefined) return
  await new Promise<void>((resolve) => { active.close(() => { resolve() }) })
})

it('rejects unauthenticated and unknown requests without invoking synthesis', async () => {
  let calls = 0
  const url = await listen(() => { calls++; return speech })
  const unauthorized = await fetch(`${url}/synthesize`, { method: 'POST', body: '{}' })
  expect(unauthorized.status).toBe(401)
  expect((await post(url, '{}', 'Bearer bad')).status).toBe(401)
  expect((await fetch(`${url}/missing`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(404)
  expect(calls).toBe(0)
})

it('returns WAV audio with timing headers for valid synthesis input', async () => {
  const url = await listen((text, voiceId) => {
    expect(text).toBe('你好')
    expect(voiceId).toBe('zf_xiaobei')
    return speech
  })
  const response = await post(url, JSON.stringify({ text: '你好', voiceId: 'zf_xiaobei' }))
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('audio/wav')
  expect(response.headers.get('x-dsh-sample-rate')).toBe('24000')
  const audio = new Uint8Array(await response.arrayBuffer())
  expect(audio.length).toBe(speech.audio.length)
  expect(Buffer.from(audio.slice(0, 4)).toString('ascii')).toBe('RIFF')
  expect(Buffer.from(audio.slice(8, 12)).toString('ascii')).toBe('WAVE')
})

it('maps text and voice rejections to invalid-input responses', async () => {
  const url = await listen((text, voiceId) => {
    if (voiceId === 'missing') throw new Error('boom')
    throw new SynthesisInputError(voiceId === 'empty' ? text : 'too long')
  })
  const empty = await post(url, JSON.stringify({ text: ' ', voiceId: 'empty' }))
  expect(empty.status).toBe(400)
  expect(await empty.json()).toMatchObject({ code: 'invalid-input' })
  const malformed = await post(url, '{bad json')
  expect(malformed.status).toBe(400)
  expect(await malformed.json()).toMatchObject({ code: 'invalid-input' })
  const failed = await post(url, JSON.stringify({ text: 'hi', voiceId: 'missing' }))
  expect(failed.status).toBe(500)
  expect(await failed.json()).toMatchObject({ error: 'boom' })
})

it('rejects oversized requests at the transport boundary', async () => {
  const url = await listen(() => speech)
  const tooLarge = await post(url, JSON.stringify({ text: 'x'.repeat(5000), voiceId: 'zf_xiaobei' }))
  expect(tooLarge.status).toBe(413)
  expect(await tooLarge.json()).toMatchObject({ code: 'invalid-input' })
  const address = new URL(url)
  const status = await new Promise<number>((resolve, reject) => {
    const socket = connect(Number(address.port), '127.0.0.1', () => {
      socket.write(`POST /synthesize HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${token}\r\nContent-Length: 999999\r\n\r\n`)
    })
    socket.once('data', (chunk) => { resolve(Number(chunk.toString('ascii').split('\r\n')[0]?.split(' ')[1])); socket.destroy() })
    socket.on('error', reject)
  })
  expect(status).toBe(413)
})
