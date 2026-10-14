import { expect, test } from '@playwright/test'

// Mock analyst + builder (no Claude login needed): exercises the UI, the live loop,
// the Vite preview through the proxy, and the wrap-up screen.
test('sample conversation becomes a previewable app', async ({ page, request }) => {
  const denied = await request.get('/api/state')
  expect(denied.status()).toBe(401)

  await page.goto('/?key=e2e-token')
  await expect(page.getByRole('heading', { name: 'Ambient Builder' })).toBeVisible()
  await page.screenshot({ path: 'test-results/home.png' })
  await page.getByRole('button', { name: /Try the sample conversation/ }).click()

  // The Live tab shows the builder at work.
  await expect(page.locator('.status-text')).toContainText(/Writing|Reading|Build|Planning/, { timeout: 60_000 })
  await page.screenshot({ path: 'test-results/live.png' })

  // The ledger fills in as the replay plays.
  await page.locator('nav.tabs').getByRole('button', { name: /Plan/ }).click()
  await expect(page.getByText('Track total subscription spending')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Charge users a per-user fee')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/punishes users and risks adoption/)).toBeVisible()
  await page.screenshot({ path: 'test-results/plan.png' })

  // The generated app shows up in the live preview.
  await page.locator('nav.tabs').getByRole('button', { name: /App/ }).click()
  const app = page.frameLocator('iframe[title="App preview"]')
  await expect(app.getByTestId('app-title')).toHaveText('subscription-tracker', { timeout: 120_000 })
  await expect(app.getByText('Dashboard with spend history per subscription')).toBeVisible({ timeout: 60_000 })
  await page.screenshot({ path: 'test-results/preview.png' })

  // Wrap up: summary + GitHub step (we never click publish in tests).
  await page.getByRole('button', { name: 'Wrap up' }).click()
  await expect(page.getByText('Where it lives')).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('button', { name: /Save to GitHub|Connect GitHub/ }).or(page.getByText('Saved to GitHub'))).toBeVisible()
  await page.screenshot({ path: 'test-results/end.png', fullPage: true })

  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('subscription-tracker')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save to GitHub' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
})
