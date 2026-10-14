import { describe, expect, it } from 'vitest'
import { PcmChunker, toWav } from '../src/transcribe/chunker.js'

const frame = (loud: boolean, ms = 100) => {
  const f = new Int16Array(16 * ms)
  if (loud) for (let i = 0; i < f.length; i++) f[i] = Math.round(Math.sin(i / 5) * 8000)
  return f
}

describe('PcmChunker', () => {
  it('cuts at a pause after the minimum length', () => {
    const chunks: number[] = []
    const c = new PcmChunker((p) => chunks.push(p.length / 16000))
    for (let i = 0; i < 45; i++) c.push(frame(true)) // 4.5s speech
    expect(chunks).toEqual([])
    for (let i = 0; i < 5; i++) c.push(frame(false)) // 0.5s pause
    expect(chunks).toEqual([5])
  })

  it('cuts at the maximum length even without a pause', () => {
    const chunks: number[] = []
    const c = new PcmChunker((p) => chunks.push(p.length))
    for (let i = 0; i < 130; i++) c.push(frame(true))
    expect(chunks.length).toBe(1)
  })

  it('drops silence-only chunks', () => {
    const chunks: number[] = []
    const c = new PcmChunker((p) => chunks.push(p.length))
    for (let i = 0; i < 130; i++) c.push(frame(false))
    c.flush()
    expect(chunks).toEqual([])
  })

  it('writes a valid WAV header', () => {
    const wav = toWav(new Int16Array(16000))
    expect(wav.subarray(0, 4).toString()).toBe('RIFF')
    expect(wav.readUInt32LE(24)).toBe(16000)
    expect(wav.length).toBe(44 + 32000)
  })
})
