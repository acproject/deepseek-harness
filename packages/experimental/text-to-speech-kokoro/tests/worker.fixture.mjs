/** Protocol fixture replacing the native synthesizer, with real process and HTTP lifetimes. */
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

const root = JSON.parse(process.argv[2]).model
const wav = Buffer.alloc(46)
wav.write('RIFF', 0, 'ascii')
wav.writeUInt32LE(38, 4)
wav.write('WAVE', 8, 'ascii')
wav.write('fmt ', 12, 'ascii')
wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20)
wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(24000, 24)
wav.writeUInt32LE(48000, 28)
wav.writeUInt16LE(2, 32)
wav.writeUInt16LE(16, 34)
wav.write('data', 36, 'ascii')
wav.writeUInt32LE(2, 40)

const server = createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${process.env.DSH_TTS_TOKEN}`) {
    response.writeHead(401).end(); return
  }
  const chunks = []
  request.on('data', chunk => { chunks.push(chunk) })
  request.on('end', () => {
    const { text, voiceId } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    appendFileSync(join(root, 'requests'), `${voiceId}:${text}\n`)
    if (text === 'hold') return
    if (text === 'crash') { process.exit(1); return }
    if (voiceId === 'broken') {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'provider failed' }))
      return
    }
    response.writeHead(200, {
      'content-type': 'audio/wav',
      'x-dsh-sample-rate': '24000',
      'x-dsh-audio-seconds': '0.5',
      'x-dsh-synthesis-seconds': '0.1',
    })
    response.end(wav)
  })
})
server.listen(0, '127.0.0.1', () => { process.stdout.write(`${JSON.stringify({ port: server.address().port })}\n`) })
