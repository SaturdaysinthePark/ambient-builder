import { expect, Page, test } from '@playwright/test'

// Design-review screenshots of every state in the journey. Not a pass/fail test of looks:
// it drives the flow and writes PNGs to test-results/screens/ for critique.
// Run: SCREENS=1 npx playwright test screens
test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture design screenshots')

const dir = 'test-results/screens'
const TOKEN = { 'x-ambient-token': 'e2e-token' }

async function shot(page: Page, name: string, opts: { both?: boolean; full?: boolean } = {}) {
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: opts.full })
  if (opts.both) {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.waitForTimeout(150)
    await page.screenshot({ path: `${dir}/${name}-dark.png`, fullPage: opts.full })
    await page.emulateMedia({ colorScheme: 'light' })
  }
}

test('journey screens (phone)', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/?key=e2e-token')
  await expect(page.getByRole('heading', { name: /Talk it through/ })).toBeVisible()
  await shot(page, '01-home-first-run', { both: true })

  await page.getByRole('button', { name: 'Open on your phone' }).click()
  await shot(page, '02-home-qr')
  await page.getByRole('button', { name: 'Open on your phone' }).click()

  await page.getByRole('button', { name: 'Start listening' }).click()
  await expect(page.locator('.status')).toContainText('Listening')
  await page.waitForTimeout(1200)
  await shot(page, '03-live-empty')

  await request.post('/api/session/replay', { headers: TOKEN, data: { speed: 4 } })
  await expect(page.locator('.note').nth(3)).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.status')).toContainText('Building', { timeout: 30_000 })
  await shot(page, '04-live-building')
  await expect(page.locator('.note.is-superseded')).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(2500)
  await shot(page, '05-live-notes')

  await page.getByRole('button', { name: 'Write a note' }).click()
  await shot(page, '06-live-note-field')
  await page.getByRole('button', { name: 'Write a note' }).click()

  await page.getByRole('button', { name: 'Pause listening' }).click()
  await shot(page, '07-live-paused')

  await page.getByRole('button', { name: /^App/ }).click()
  await expect(page.frameLocator('.app-pane iframe').getByTestId('app-title')).toBeVisible({ timeout: 120_000 })
  await shot(page, '08-app-overlay')
  await page.getByRole('button', { name: '← Notes' }).click()

  await page.getByRole('button', { name: 'End' }).click()
  await shot(page, '09-wrap-sheet')
  await page.getByRole('button', { name: 'Wrap up' }).click()
  await expect(page.locator('.ending')).toBeVisible()
  await shot(page, '10-ending')

  await expect(page.getByRole('heading', { name: 'Keep it' })).toBeVisible({ timeout: 120_000 })
  await page.waitForTimeout(1500)
  await shot(page, '11-outcome', { both: true })
  await shot(page, '12-outcome-full', { full: true })

  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.locator('.idea').first()).toBeVisible()
  await shot(page, '13-home-ideas', { both: true })
})

test('journey screens (laptop)', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/?key=e2e-token')
  await shot(page, '20-desktop-home')
  await page.locator('.idea').first().getByRole('button', { name: 'Continue' }).click()
  await expect(page.locator('.note').first()).toBeVisible()
  await expect(page.frameLocator('.app-pane iframe').getByTestId('app-title')).toBeVisible({ timeout: 120_000 })
  await shot(page, '21-desktop-session')
  await request.post('/api/session/end', { headers: TOKEN })
})

test('edge states: blocked mic, no speech engine', async ({ page, request }) => {
  // Blocked microphone: the browser refuses getUserMedia.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }))
  })
  await page.goto('/?key=e2e-token')
  await page.getByRole('button', { name: 'Start listening' }).click()
  await expect(page.getByRole('alert')).toContainText('Microphone access is blocked')
  await shot(page, '30-mic-blocked')
  await request.post('/api/session/end', { headers: TOKEN })

  // No Whisper and no browser speech recognition: typing mode.
  const typing = await page.context().newPage()
  await typing.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>
    delete w.SpeechRecognition
    delete w.webkitSpeechRecognition
  })
  await typing.route('**/api/state', async (route) => {
    const res = await route.fetch()
    const json = await res.json()
    json.settings.whisper = false
    await route.fulfill({ response: res, json })
  })
  await typing.goto('/?key=e2e-token')
  await shot(typing, '31-home-typing-only')
  await typing.getByRole('button', { name: 'Start a conversation' }).click()
  await typing.getByLabel('Note', { exact: true }).fill('We should make a habit tracker for plants')
  await shot(typing, '32-live-typing-only')
  await request.post('/api/session/end', { headers: TOKEN })
})
