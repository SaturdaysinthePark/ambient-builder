import { useCallback, useEffect, useRef, useState } from 'react'
import { api, useLive } from './api'
import { browserSpeechAvailable, MicHandle, MicMode, startMic } from './mic'
import type { ProjectCard, Settings } from './types'
import Home from './components/Home'
import Outcome from './components/Outcome'
import Session from './components/Session'

export default function App() {
  const live = useLive()
  const [projects, setProjects] = useState<ProjectCard[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [onHome, setOnHome] = useState(true)
  const [listening, setListening] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [micBlocked, setMicBlocked] = useState(false)
  const mic = useRef<MicHandle | null>(null)
  const level = useRef(0)

  const refresh = useCallback(async () => {
    const s = await api.state()
    setProjects(s.projects)
    setSettings(s.settings)
    if (s.snapshot && s.snapshot.phase !== 'ended') {
      live.setSnapshot(s.snapshot)
      setOnHome(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refresh().catch((e) => setNotice(String(e.message)))
  }, [refresh])

  // Unknown until settings load, so a quick tap can't pick the wrong speech engine.
  const micMode: MicMode | null = !settings ? null : settings.whisper ? 'whisper' : browserSpeechAvailable() ? 'browser' : null

  const stopListening = () => {
    mic.current?.stop()
    mic.current = null
    level.current = 0
    setListening(false)
  }
  const startListening = async () => {
    if (!micMode || mic.current) return
    try {
      mic.current = await startMic(
        micMode,
        live.send,
        (m) => {
          setNotice(m)
          stopListening()
        },
        (l) => (level.current = l),
      )
      setListening(true)
      setMicBlocked(false)
    } catch (e) {
      mic.current = null
      const denied = (e as Error).name === 'NotAllowedError'
      setMicBlocked(denied)
      setNotice(
        denied
          ? 'Microphone access is blocked. Allow it in the browser’s site settings, then tap the line.'
          : `The microphone didn’t start (${(e as Error).message}). On a phone, use the HTTPS link from npm run tunnel.`,
      )
    }
  }

  const begin = async (projectId?: string, withMic = true) => {
    if (withMic) void startListening() // inside the tap, before any await
    const snap = await api.start(projectId)
    live.setSnapshot(snap)
    setOnHome(false)
  }

  const goHome = async () => {
    stopListening()
    setOnHome(true)
    await refresh().catch(() => {})
  }

  const snap = live.snapshot
  const message = notice || live.error
  return (
    <>
      {message && (
        <div className="toast" role="alert">
          <span>{message}</span>
          <button className="text-btn" onClick={() => (setNotice(null), live.clearError())} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      {onHome || !snap ? (
        <Home projects={projects} settings={settings} micMode={micMode} onStart={begin} onRefresh={refresh} />
      ) : snap.phase === 'ended' ? (
        <Outcome snap={snap} settings={settings} onHome={goHome} onSettings={setSettings} />
      ) : (
        <Session
          snap={snap}
          micMode={micMode}
          listening={listening}
          micBlocked={micBlocked}
          level={level}
          connected={live.connected}
          onToggleMic={() => (listening ? stopListening() : startListening())}
          onEnd={async () => {
            stopListening()
            live.setSnapshot(await api.end())
          }}
        />
      )}
    </>
  )
}
