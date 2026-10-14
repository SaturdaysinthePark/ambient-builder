import { useCallback, useEffect, useRef, useState } from 'react'
import { api, useLive } from './api'
import { displayName } from './format'
import { browserSpeechAvailable, MicHandle, MicMode, startMic } from './mic'
import type { ProjectCard, Settings, Snapshot } from './types'
import Menu, { Target } from './components/Menu'
import Recorder, { Line } from './components/Recorder'

/** Tapping record within this long after a stop keeps going on the same idea. */
const KEEP_GOING_MS = 15 * 60_000

const endedAt = (p?: { conversations: { endedAt?: string }[] }) => {
  const e = p?.conversations.at(-1)?.endedAt
  return e ? new Date(e).getTime() : 0
}

export default function App() {
  const live = useLive()
  const [projects, setProjects] = useState<ProjectCard[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [target, setTarget] = useState<Target>('auto')
  const [listening, setListening] = useState(false)
  const [micBlocked, setMicBlocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [seen, setSeen] = useState<{ commit?: string; phase?: string; error?: string }>({})
  const [appSeen, setAppSeen] = useState<string>()
  const [menuWide, setMenuWide] = useState(false)
  const mic = useRef<MicHandle | null>(null)
  const level = useRef(0)
  const snap = live.snapshot

  const refresh = useCallback(async () => {
    const s = await api.state()
    setProjects(s.projects)
    setSettings(s.settings)
    if (s.snapshot) live.setSnapshot(s.snapshot)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refresh().catch((e) => setNotice(String(e.message)))
  }, [refresh])
  // When a wrap-up finishes, the idea list (summaries, counts) has changed.
  useEffect(() => {
    if (snap?.phase === 'ended') refresh().catch(() => {})
  }, [snap?.phase, refresh])

  // Unknown until settings load, so a quick tap can't pick the wrong speech engine.
  const micMode: MicMode | null = !settings ? null : settings.whisper ? 'whisper' : browserSpeechAvailable() ? 'browser' : null
  const recording = snap?.phase === 'live'

  // Which idea the next recording continues.
  const recent: { id: string; name: string } | undefined =
    snap && snap.phase === 'ended' && Date.now() - endedAt(snap.project) < KEEP_GOING_MS
      ? snap.project
      : projects[0] && Date.now() - endedAt(projects[0]) < KEEP_GOING_MS
        ? projects[0]
        : undefined
  const nextId = recording ? snap!.project.id : target === 'new' ? undefined : target === 'auto' ? recent?.id : target
  const nextName = nextId ? (projects.find((p) => p.id === nextId) ?? (snap?.project.id === nextId ? snap.project : undefined))?.name : undefined

  const stopListening = () => {
    mic.current?.stop()
    mic.current = null
    level.current = 0
    setListening(false)
  }

  /** Starts the mic. Resolves false if it couldn't (blocked, no HTTPS, …). */
  const startListening = async (): Promise<boolean> => {
    if (!micMode || mic.current) return !!mic.current
    try {
      mic.current = await startMic(
        micMode,
        live.send,
        (m) => {
          setNotice(m)
          setMicBlocked(true)
          stopListening()
        },
        // Decaying peak, so brief sounds still register between UI samples.
        (l) => (level.current = Math.max(l, level.current * 0.85)),
      )
      setListening(true)
      setMicBlocked(false)
      return true
    } catch (e) {
      mic.current = null
      const denied = (e as Error).name === 'NotAllowedError'
      setMicBlocked(denied)
      if (!denied) setNotice(`The microphone didn’t start (${(e as Error).message}). On a phone, use the HTTPS link from npm run tunnel.`)
      return false
    }
  }

  const record = async () => {
    setBusy(true)
    try {
      // Ask for the mic first, inside the tap; no session is created if it's blocked.
      if (micMode && !(await startListening())) return
      live.setSnapshot(await api.start(nextId))
      setTarget('auto')
    } catch (e) {
      stopListening()
      setNotice((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    stopListening()
    try {
      live.setSnapshot(await api.end()) // returns at once; the wrap-up continues on the laptop
    } catch (e) {
      setNotice((e as Error).message)
    }
  }

  const sample = async () => {
    setMenuOpen(false)
    stopListening()
    live.setSnapshot(await api.start(undefined))
    await api.replay(2)
  }

  // The menu dot: something new since the menu was last opened.
  const latest = snap && snap.commits.length > 1 ? snap.commits[0].hash : undefined
  const menuDot =
    !!snap && ((latest !== undefined && latest !== seen.commit) || (snap.phase === 'ended' && seen.phase !== 'ended') || (!!snap.builder.error && snap.builder.error !== seen.error))
  const openMenu = () => {
    setMenuOpen(true)
    if (snap) setSeen({ commit: latest, phase: snap.phase, error: snap.builder.error })
  }
  // While the menu is open, everything in it counts as seen.
  useEffect(() => {
    if (menuOpen && snap) setSeen({ commit: latest, phase: snap.phase, error: snap.builder.error })
  }, [menuOpen, latest, snap?.phase, snap?.builder.error]) // eslint-disable-line react-hooks/exhaustive-deps

  const line = lineFor({ snap, recording, micMode, settings, micBlocked, connected: live.connected, nextName, target, hasProjects: projects.length > 0 })

  return (
    <>
      {(notice || live.error) && (
        <div className="toast" role="alert">
          <span>{notice || live.error}</span>
          <button className="text-btn" onClick={() => (setNotice(null), live.clearError())} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      <Recorder
        recording={recording}
        busy={busy || (!recording && (!settings || snap?.phase === 'ending'))}
        line={line}
        level={level}
        menuDot={menuDot && !menuOpen}
        panel={menuOpen ? (menuWide ? 'wide' : 'narrow') : undefined}
        onToggle={() => (recording ? stop() : record())}
        onMenu={openMenu}
      />
      {menuOpen && (
        <Menu
          snap={snap}
          projects={projects}
          settings={settings}
          micMode={micMode}
          target={target}
          nextId={nextId}
          appSeen={appSeen}
          onAppSeen={setAppSeen}
          onTarget={setTarget}
          onSample={sample}
          onRefresh={refresh}
          onClose={() => setMenuOpen(false)}
          onWide={setMenuWide}
        />
      )}
    </>
  )
}

function lineFor(s: {
  snap: Snapshot | null
  recording: boolean
  micMode: MicMode | null
  settings: Settings | null
  micBlocked: boolean
  connected: boolean
  nextName?: string
  target: Target
  hasProjects: boolean
}): Line {
  if (!s.connected) return { kind: 'problem', text: 'Reconnecting to the laptop…' }
  if (s.recording && s.snap) return { kind: 'timer', since: s.snap.project.conversations.at(-1)?.startedAt ?? new Date().toISOString() }
  if (s.micBlocked) return { kind: 'problem', text: 'Microphone blocked. Allow it in site settings, then tap again.' }
  if (s.snap?.phase === 'ending') return { kind: 'hint', text: 'Finishing up…' }
  if (s.settings && !s.micMode) return { kind: 'hint', text: 'This browser can’t transcribe. Tap to start, then add notes from the menu.' }
  if (s.nextName) {
    const justSaved = s.snap?.phase === 'ended' && s.target === 'auto' && s.snap.project.name === s.nextName
    return { kind: 'hint', text: `${justSaved ? 'Saved · ' : ''}Tap to keep going on ${displayName(s.nextName)}` }
  }
  if (s.target === 'new' && s.hasProjects) return { kind: 'hint', text: 'Tap to record a new idea' }
  return { kind: 'hint', text: 'Tap to record. Let everyone know.' }
}
