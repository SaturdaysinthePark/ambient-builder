import path from 'node:path'
import { defineConfig } from '@playwright/test'

const PORT = 4399
const WHISPER = 8179
export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    permissions: ['microphone'],
    launchOptions: {
      // A fake microphone (a steady tone) so the real audio path runs end to end.
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
      ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
    },
  },
  webServer: [
    {
      command: `node e2e/fake-whisper.mjs`,
      url: `http://127.0.0.1:${WHISPER}/`,
      env: { FAKE_WHISPER_PORT: String(WHISPER) },
      reuseExistingServer: false,
    },
    {
      command: 'npm run start -w server',
      url: `http://127.0.0.1:${PORT}/api/state?key=e2e-token`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(PORT),
        AMBIENT_MOCK: '1',
        AMBIENT_TOKEN: 'e2e-token',
        AMBIENT_ANALYST_INTERVAL_MS: '2000',
        AMBIENT_PROJECTS_DIR: path.join(process.cwd(), '.e2e-projects'),
        AMBIENT_PREVIEW_PORT_BASE: '5290',
        WHISPER_URL: `http://127.0.0.1:${WHISPER}`,
      },
    },
  ],
})
