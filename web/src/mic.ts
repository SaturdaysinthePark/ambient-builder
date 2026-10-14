export type MicMode = 'whisper' | 'browser'

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}

export function browserSpeechAvailable() {
  const w = window as unknown as Record<string, unknown>
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition)
}

export interface MicHandle {
  stop(): void
}

/**
 * Starts listening. 'whisper' streams 16 kHz PCM to the laptop (transcribed there);
 * 'browser' uses the browser's own speech recognition and sends text.
 * Also holds a screen wake lock: a sleeping phone stops the mic.
 */
export async function startMic(
  mode: MicMode,
  send: (d: ArrayBuffer | string) => void,
  onError: (m: string) => void,
  onLevel: (level: number) => void = () => {},
): Promise<MicHandle> {
  // Create the AudioContext before any await so it counts as part of the tap (iOS autoplay rules).
  const ctx = mode === 'whisper' ? new AudioContext() : undefined
  let wakeLock: { release(): Promise<void> } | undefined
  try {
    wakeLock = await (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen')
  } catch {
    /* not supported; fine */
  }

  if (mode === 'browser') {
    const w = window as unknown as Record<string, new () => SpeechRecognitionLike>
    const Rec = w.SpeechRecognition || w.webkitSpeechRecognition
    const rec = new Rec()
    let running = true
    rec.continuous = true
    rec.interimResults = true
    rec.lang = navigator.language || 'en-US'
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal && r[0].transcript.trim()) send(JSON.stringify({ type: 'text', text: r[0].transcript }))
        else onLevel(0.08) // no audio levels in this mode; nudge the line when speech is heard
      }
    }
    // Browsers end recognition after silence or ~60s; keep it going.
    rec.onend = () => running && setTimeout(() => running && rec.start(), 250)
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        running = false
        onError('Microphone permission was denied.')
      }
    }
    rec.start()
    return {
      stop() {
        running = false
        rec.stop()
        void wakeLock?.release()
      },
    }
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  if (!ctx) throw new Error('no audio context')
  await ctx.resume()
  await ctx.audioWorklet.addModule('/pcm-worklet.js')
  const src = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'pcm-worklet')
  node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
    send(e.data.pcm)
    onLevel(e.data.level)
  }
  src.connect(node)
  return {
    stop() {
      send(JSON.stringify({ type: 'audio-stop' }))
      node.disconnect()
      src.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
      void wakeLock?.release()
    },
  }
}
