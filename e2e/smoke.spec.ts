import { expect, test } from '@playwright/test'

const TOKEN = { 'x-ambient-token': 'e2e-token' }

// Mock analyst + builder (no Claude login needed). Covers the whole journey:
// start → notes fill in → app preview → wrap up → outcome → back to the ideas list.
test('sample conversation becomes a previewable app', async ({ page, request }) => {
  expect((await request.get('/api/state')).status()).toBe(401)

  await page.goto('/?key=e2e-token')
  await expect(page.getByRole('heading', { name: /Talk it through/ })).toBeVisible()
  await page.getByRole('button', { name: 'Hear a sample conversation' }).click()

  // Notes fill in as the sample plays; the reversed pricing idea is struck through.
  await expect(page.getByText('Track total subscription spending')).toBeVisible({ timeout: 60_000 })
  const dropped = page.locator('.note.is-superseded', { hasText: 'Charge users a per-user fee' })
  await expect(dropped).toBeVisible({ timeout: 60_000 })
  await expect(dropped).toContainText('punishes users and risks adoption')
  await expect(page.locator('.note.is-decided').first()).toBeVisible()

  // The app is one tap away.
  await expect(page.locator('.new-dot')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: /^App/ }).click()
  const app = page.frameLocator('.app-pane iframe')
  await expect(app.getByTestId('app-title')).toHaveText('subscription-tracker', { timeout: 120_000 })
  await expect(app.getByText('Dashboard with spend history per subscription')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: '← Notes' }).click()

  // Wrap up asks first, then lands on the outcome.
  await page.getByRole('button', { name: 'End' }).click()
  await page.getByRole('button', { name: 'Keep talking' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('button', { name: 'End' }).click()
  await page.getByRole('button', { name: 'Wrap up' }).click()
  await expect(page.getByRole('heading', { name: 'Keep it' })).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Subscription tracker')
  await expect(page.getByRole('button', { name: /Save to GitHub|save now/ })).toBeVisible()

  await page.getByRole('button', { name: 'Done' }).click()
  const idea = page.locator('.idea', { hasText: 'Subscription tracker' })
  await expect(idea).toBeVisible()
  await expect(idea.getByRole('button', { name: 'Continue' })).toBeVisible()
  await expect(idea).toContainText('decided')

  // Leave nothing running for the next test.
  await request.post('/api/session/end', { headers: TOKEN }).catch(() => {})
})

// The real audio path: fake mic → AudioWorklet → WebSocket → (fake) Whisper → transcript.
test('listening streams audio to the laptop and moves the voice line', async ({ page }) => {
  await page.goto('/?key=e2e-token')
  await page.getByRole('button', { name: 'Start listening' }).click()
  await expect(page.locator('.status')).toContainText('Listening')
  await expect.poll(async () => Number(await page.getByTestId('voice-line').getAttribute('data-level')), { timeout: 10_000 }).toBeGreaterThan(0.05)
  // Whatever the (fake) Whisper heard shows up as the caption.
  await expect(page.locator('.caption')).toContainText(/subscriptions|monthly total|color the ones/, { timeout: 30_000 })

  // Tapping the line pauses.
  await page.getByRole('button', { name: 'Pause listening' }).click()
  await expect(page.locator('.status')).toContainText('Paused')
  await page.getByRole('button', { name: 'End' }).click()
  await page.getByRole('button', { name: 'Wrap up' }).click()
  await expect(page.getByRole('heading', { name: 'Keep it' })).toBeVisible({ timeout: 120_000 })
})
