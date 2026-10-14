import { useCallback, useEffect, useRef, useState } from 'react'
import { api, useLive } from './api'
import { browserSpeechAvailable, MicHandle, MicMode, startMic } from './mic'
import type { ProjectMeta, Settings } from './types'
import Home from './components/Home'
import Session from './components/Session'

export default function App() {
  const live = useLive()
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [onHome, setOnHome] = useState(true)
  const [listening, setListening] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const mic = useRef<MicHandle | null>(null)

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

  const micMode: MicMode | null = settings?.whisper ? 'whisper' : browserSpeechAvailable() ? 'browser' : null

  const startListening = async () => {
    if (!micMode || mic.current) return
    try {
      mic.current = await startMic(micMode, live.send, (m) => {
        setNotice(m)
        stopListening()
      })
      setListening(true)
    } catch (e) {
      mic.current = null
      setNotice(`Couldn't start the microphone: ${(e as Error).message}. On a phone, open the HTTPS tunnel link.`)
    }
  }
  const stopListening = () => {
    mic.current?.stop()
    mic.current = null
    setListening(false)
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
  return (
    <div className="shell">
      {(notice || live.error) && (
        <div className="toast" role="alert" onClick={() => (setNotice(null), live.clearError())}>
          {notice || live.error}
        </div>
      )}
      {onHome || !snap ? (
        <Home projects={projects} settings={settings} micMode={micMode} onStart={begin} onRefresh={refresh} />
      ) : (
        <Session
          snap={snap}
          settings={settings}
          micMode={micMode}
          listening={listening}
          connected={live.connected}
          onToggleMic={() => (listening ? stopListening() : startListening())}
          onEnd={async () => {
            stopListening()
            live.setSnapshot(await api.end())
          }}
          onHome={goHome}
          onSettings={setSettings}
        />
      )}
    </div>
  )
}
