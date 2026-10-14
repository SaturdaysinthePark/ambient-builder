import { expect, Page, test } from '@playwright/test'

// Design-review screenshots of every state. Run: npm run screens
test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture design screenshots')

const dir = 'test-results/screens'
const TOKEN = { 'x-ambient-token': 'e2e-token' }
const menu = (page: Page) => page.getByRole('dialog', { name: 'Menu' })

async function shot(page: Page, name: string, opts: { both?: boolean } = {}) {
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${dir}/${name}.png` })
  if (opts.both) {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.waitForTimeout(150)
    await page.screenshot({ path: `${dir}/${name}-dark.png` })
    await page.emulateMedia({ colorScheme: 'light' })
  }
}

test('phone', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/?key=e2e-token')
  await expect(page.getByText('Tap to record. Let everyone know.')).toBeVisible()
  await shot(page, '01-idle-first-run')

  await page.getByRole('button', { name: /^Menu/ }).click()
  await shot(page, '02-menu-empty', { both: true })
  await menu(page).getByRole('button', { name: /^Open on your phone/ }).click()
  await shot(page, '03-menu-phone')
  await page.getByRole('button', { name: 'Close menu' }).click()

  await page.getByRole('button', { name: 'Record' }).click()
  await page.waitForTimeout(2200)
  await shot(page, '04-recording')

  await request.post('/api/session/replay', { headers: TOKEN, data: { speed: 4 } })
  await expect(page.getByTestId('menu-dot')).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(6000)
  await shot(page, '05-recording-menu-dot')

  await page.getByRole('button', { name: /^Menu/ }).click()
  await shot(page, '06-menu', { both: true })
  await menu(page).getByRole('button', { name: /^Transcript/ }).click()
  await shot(page, '07-transcript', { both: true })
  await menu(page).getByRole('button', { name: 'Back', exact: true }).click()
  await menu(page).getByRole('button', { name: /^Plan/ }).click()
  await expect(menu(page).locator('.note.is-superseded')).toBeVisible({ timeout: 60_000 })
  await shot(page, '08-plan', { both: true })
  await menu(page).getByRole('button', { name: 'Back', exact: true }).click()
  await menu(page).getByRole('button', { name: /^App/ }).click()
  await expect(page.frameLocator('.app-view iframe').getByTestId('app-title')).toBeVisible({ timeout: 120_000 })
  await shot(page, '09-app')
  await menu(page).getByRole('button', { name: 'Back', exact: true }).click()
  await menu(page).getByRole('button', { name: /^Deploy/ }).click()
  await shot(page, '10-deploy-while-recording')
  await page.getByRole('button', { name: 'Close menu' }).click()

  await page.getByRole('button', { name: 'Stop recording' }).click()
  await shot(page, '11-stopping')
  await expect(page.getByText(/Saved · Tap to keep going/)).toBeVisible({ timeout: 120_000 })
  await shot(page, '12-saved')
  await page.getByRole('button', { name: /^Menu/ }).click()
  await menu(page).getByRole('button', { name: /^Deploy/ }).click()
  await shot(page, '13-deploy', { both: true })
  await menu(page).getByRole('button', { name: 'Back', exact: true }).click()
  await menu(page).getByRole('button', { name: /^Ideas/ }).click()
  await shot(page, '14-ideas', { both: true })
})

test('laptop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/?key=e2e-token')
  await shot(page, '20-laptop-idle')
  await page.getByRole('button', { name: /^Menu/ }).click()
  await menu(page).getByRole('button', { name: /^Plan/ }).click()
  await shot(page, '21-laptop-menu-plan')
  await menu(page).getByRole('button', { name: 'Back', exact: true }).click()
  await menu(page).getByRole('button', { name: /^App/ }).click()
  await page.waitForTimeout(1500)
  await shot(page, '22-laptop-menu-app')
})

test('edge states', async ({ page, request }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }))
  })
  await page.goto('/?key=e2e-token')
  await page.getByRole('button', { name: /^Menu/ }).click()
  await menu(page).getByRole('button', { name: /^Ideas/ }).click()
  await menu(page).getByRole('button', { name: /^New idea/ }).click()
  await page.getByRole('button', { name: 'Record' }).click()
  await expect(page.getByText(/Microphone blocked/)).toBeVisible()
  await shot(page, '30-mic-blocked')

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
    json.snapshot = null
    await route.fulfill({ response: res, json })
  })
  await typing.goto('/?key=e2e-token')
  await expect(typing.getByText(/can’t transcribe/)).toBeVisible()
  await shot(typing, '31-typing-only')
  await request.post('/api/session/end', { headers: TOKEN }).catch(() => {})
})
