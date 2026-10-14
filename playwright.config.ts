import path from 'node:path'
import { defineConfig } from '@playwright/test'

const PORT = 4399
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 390, height: 844 },
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
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
    },
  },
})
