import { test, expect } from '@playwright/test'

test('landing page loads', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /loopcast|стрім|stream/i }).first()).toBeVisible()
  await expect(
    page.getByRole('button', {
      name: /start free|почати безкоштовно|начать бесплатно/i,
    }).first()
  ).toBeVisible()
})

test('login page loads', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('input[type="email"]')).toBeVisible()
  await expect(page.locator('input[type="password"]')).toBeVisible()
})

test('dashboard redirects to login when unauthenticated', async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === '1', 'Dev auth bypass enabled')
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
})
