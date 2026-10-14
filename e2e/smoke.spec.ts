import { APIRequestContext, expect, Page, test } from '@playwright/test'

const TOKEN = { 'x-ambient-token': 'e2e-token' }
const state = async (request: APIRequestContext) => (await request.get('/api/state', { headers: TOKEN })).json()
const menu = (page: Page) => page.getByRole('dialog', { name: 'Menu' })
const openMenuTo = async (page: Page, row: string) => {
  await page.getByRole('button', { name: /^Menu/ }).click()
  await menu(page).getByRole('button', { name: new RegExp(`^${row}`) }).click()
}
const closeMenu = (page: Page) => page.getByRole('button', { name: 'Close menu' }).click()

// Mock analyst + builder, fake mic, fake Whisper. The whole journey through one button.
test('record, build silently, stop, keep going', async ({ page, request }) => {
  expect((await request.get('/api/state')).status()).toBe(401)
  await page.goto('/?key=e2e-token')
  await expect(page.getByText('Tap to record. Let everyone know.')).toBeVisible()

  // Tap to record: timer runs, the mic is really hearing the (fake) room.
  await page.getByRole('button', { name: 'Record' }).click()
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible()
  await expect(page.locator('.timer')).toHaveText(/0:0\d/)
  await expect.poll(async () => Number(await page.getByTestId('live-dot').getAttribute('data-level')), { timeout: 15_000 }).toBeGreaterThan(0)
  const first = (await state(request)).snapshot.project.id

  // The conversation (sample script) arrives; nothing changes on the main screen but the menu dot.
  await request.post('/api/session/replay', { headers: TOKEN, data: { speed: 4 } })
  await expect(page.getByTestId('menu-dot')).toBeVisible({ timeout: 60_000 })

  await openMenuTo(page, 'Transcript')
  await expect(menu(page).getByText(/register their subscriptions/)).toBeVisible({ timeout: 30_000 })
  await menu(page).getByRole('button', { name: 'Back', exact: true }).click()

  await menu(page).getByRole('button', { name: /^Plan/ }).click()
  await expect(menu(page).locator('.note.is-decided').first()).toBeVisible()
  const dropped = menu(page).locator('.note.is-superseded', { hasText: 'Charge users a per-user fee' })
  await expect(dropped).toBeVisible({ timeout: 60_000 })
  await expect(dropped).toContainText('punishes users and risks adoption')
  await menu(page).getByRole('button', { name: 'Back', exact: true }).click()

  await menu(page).getByRole('button', { name: /^App/ }).click()
  const app = page.frameLocator('.app-view iframe')
  await expect(app.getByTestId('app-title')).toHaveText('subscription-tracker', { timeout: 120_000 })
  await closeMenu(page)
  await expect(page.getByTestId('menu-dot')).toBeHidden()

  // Tap to stop: it wraps up quietly, then offers to keep going.
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(page.getByText(/Finishing up…|Tap to keep going/)).toBeVisible()
  await expect(page.getByText('Saved · Tap to keep going on Subscription tracker')).toBeVisible({ timeout: 120_000 })
  await expect(page.getByTestId('menu-dot')).toBeVisible()

  await openMenuTo(page, 'Deploy')
  await expect(menu(page).getByText('The app builds cleanly.')).toBeVisible()
  await expect(menu(page).getByRole('button', { name: /Save to a private repo|save now/ })).toBeVisible() // never clicked in tests
  await closeMenu(page)

  // Tap again: same idea, second conversation.
  await page.getByRole('button', { name: 'Record' }).click()
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible()
  const again = (await state(request)).snapshot.project
  expect(again.id).toBe(first)
  expect(again.conversations).toHaveLength(2)
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(page.getByText(/Tap to keep going/)).toBeVisible({ timeout: 120_000 })

  // New idea from the menu: the next recording starts fresh.
  await openMenuTo(page, 'Ideas')
  await menu(page).getByRole('button', { name: /^New idea/ }).click()
  await expect(page.getByText('Tap to record a new idea')).toBeVisible()
  await page.getByRole('button', { name: 'Record' }).click()
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible()
  expect((await state(request)).snapshot.project.id).not.toBe(first)
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(page.getByText(/Tap to keep going/)).toBeVisible({ timeout: 120_000 })
})

test('sample conversation from the menu, and what the fake mic heard', async ({ page, request }) => {
  await page.goto('/?key=e2e-token')
  await page.getByRole('button', { name: /^Menu/ }).click()
  await menu(page).getByRole('button', { name: 'Hear a sample conversation' }).click()
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible()
  await expect.poll(async () => (await state(request)).snapshot.ledger.items.length, { timeout: 60_000 }).toBeGreaterThan(2)
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(page.getByText(/Tap to keep going/)).toBeVisible({ timeout: 120_000 })

  // Audio path: fake mic → AudioWorklet → WebSocket → (fake) Whisper → transcript.
  await openMenuTo(page, 'Ideas')
  await menu(page).getByRole('button', { name: /^New idea/ }).click()
  await page.getByRole('button', { name: 'Record' }).click()
  await expect
    .poll(async () => ((await state(request)).snapshot.transcript as { source: string }[]).filter((l) => l.source === 'whisper').length, { timeout: 40_000 })
    .toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(page.getByText(/Tap to keep going/)).toBeVisible({ timeout: 120_000 })
})
