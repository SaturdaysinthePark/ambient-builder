// Downsamples the mic to 16 kHz mono 16-bit PCM and posts ~100 ms frames,
// each with its loudness (RMS, 0..1) so the UI can draw the voice line.
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / 16000
    this.pos = 0
    this.out = new Int16Array(1600)
    this.n = 0
    this.sq = 0
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    while (this.pos < ch.length) {
      const s = Math.max(-1, Math.min(1, ch[Math.floor(this.pos)]))
      this.sq += s * s
      this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff
      if (this.n === this.out.length) {
        const level = Math.sqrt(this.sq / this.n)
        this.port.postMessage({ pcm: this.out.buffer, level }, [this.out.buffer])
        this.out = new Int16Array(1600)
        this.n = 0
        this.sq = 0
      }
      this.pos += this.ratio
    }
    this.pos -= ch.length
    return true
  }
}
registerProcessor('pcm-worklet', PcmWorklet)
