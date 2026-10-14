/** Turns audio into text. The browser Web Speech mode skips this entirely and sends text. */
export interface Transcriber {
  readonly name: string
  available(): Promise<boolean>
  /** 16 kHz mono 16-bit PCM in, text out ('' for silence). */
  transcribe(pcm: Int16Array): Promise<string>
}

export const SAMPLE_RATE = 16_000
