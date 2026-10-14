import { SAMPLE_RATE } from './types.js'

/**
 * Collects streamed PCM and cuts it into utterance-sized chunks at pauses,
 * so Whisper sees whole phrases rather than words sliced in half.
 */
export class PcmChunker {
  private buf: Int16Array[] = []
  private samples = 0
  private quietRun = 0
  private voiced = 0

  constructor(
    private onChunk: (pcm: Int16Array) => void,
    private opts = { minSec: 4, maxSec: 12, pauseSec: 0.5, silenceRms: 500 },
  ) {}

  push(frame: Int16Array) {
    this.buf.push(frame)
    this.samples += frame.length
    const loud = rms(frame) > this.opts.silenceRms
    if (loud) {
      this.voiced += frame.length
      this.quietRun = 0
    } else {
      this.quietRun += frame.length
    }
    const sec = this.samples / SAMPLE_RATE
    if ((sec >= this.opts.minSec && this.quietRun / SAMPLE_RATE >= this.opts.pauseSec) || sec >= this.opts.maxSec) this.flush()
  }

  /** Emit what's buffered. Chunks that are mostly silence are dropped (Whisper invents text on silence). */
  flush() {
    if (!this.samples) return
    const out = new Int16Array(this.samples)
    let o = 0
    for (const b of this.buf) {
      out.set(b, o)
      o += b.length
    }
    const voicedSec = this.voiced / SAMPLE_RATE
    this.buf = []
    this.samples = 0
    this.quietRun = 0
    this.voiced = 0
    if (voicedSec >= 0.3) this.onChunk(out)
  }
}

export function rms(frame: Int16Array) {
  if (!frame.length) return 0
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
  return Math.sqrt(sum / frame.length)
}

export function toWav(pcm: Int16Array, sampleRate = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44)
  const dataLen = pcm.length * 2
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataLen, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataLen, 40)
  return Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, dataLen)])
}
