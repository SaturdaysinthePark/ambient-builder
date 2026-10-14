import { useEffect, useRef } from 'react'

/**
 * One line that moves with the room's voices. Tapping it pauses/resumes listening.
 * - live: driven by mic loudness (0..1) pushed through `level`
 * - idle: listening but without levels (browser speech mode): a slow breath
 * - paused: a still, dashed line
 */
export default function VoiceLine({
  state,
  level,
  onToggle,
  disabled,
}: {
  state: 'live' | 'idle' | 'paused'
  level: { current: number }
  onToggle: () => void
  disabled?: boolean
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const history = useRef<number[]>(new Array(96).fill(0))
  const smooth = useRef(0)

  useEffect(() => {
    const c = canvas.current!
    const ctx = c.getContext('2d')!
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let last = 0
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      if (t - last < 33) return // ~30 fps is plenty
      last = t
      const dpr = window.devicePixelRatio || 1
      const w = c.clientWidth
      const h = c.clientHeight
      if (c.width !== w * dpr || c.height !== h * dpr) {
        c.width = w * dpr
        c.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const color = getComputedStyle(c).color
      const hist = history.current
      // Speech RMS rarely exceeds ~0.2; map it to 0..1 with a soft curve.
      const target = state === 'live' ? Math.min(1, Math.sqrt(level.current * 6)) : state === 'idle' ? 0.1 + 0.05 * Math.sin(t / 900) + level.current : 0
      if (state === 'idle') level.current *= 0.9
      // Ease toward the target so the line swells and settles like a voice, not a pulse monitor.
      smooth.current += (target - smooth.current) * (target > smooth.current ? 0.35 : 0.12)
      if (state === 'paused') hist.fill(0)
      hist.push(smooth.current)
      hist.shift()
      c.dataset.level = smooth.current.toFixed(2)

      ctx.strokeStyle = color
      ctx.lineWidth = 1.75
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.setLineDash(state === 'paused' ? [1, 7] : [])
      ctx.beginPath()
      const mid = h / 2
      const n = hist.length
      for (let x = 0; x <= w; x += 2) {
        const p = (x / w) * (n - 1)
        const a = hist[Math.floor(p)] * (1 - (p % 1)) + hist[Math.min(n - 1, Math.ceil(p))] * (p % 1)
        // Taper both ends so the line reads as one stroke, not a chart.
        const taper = Math.sin((x / w) * Math.PI)
        const wave = Math.sin(x / 4.5 + (reduce ? 0 : t / 120)) * 0.7 + Math.sin(x / 11 - (reduce ? 0 : t / 300)) * 0.3
        const y = mid + wave * a * taper * (h * 0.44)
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [state, level])

  return (
    <button className={`voice voice-${state}`} onClick={onToggle} disabled={disabled} aria-label={state === 'paused' ? 'Resume listening' : 'Pause listening'} aria-pressed={state !== 'paused'}>
      <canvas ref={canvas} className="voice-canvas" data-testid="voice-line" />
    </button>
  )
}
