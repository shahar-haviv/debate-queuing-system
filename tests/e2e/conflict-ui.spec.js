/**
 * Conflict of interest, through the real UI.
 *
 * The default run is read-only: it opens the candidate modal, checks the
 * "Interviewer conflicts" field, and closes it again without saving.
 *
 * The full round trip — create a candidate with a restricted interviewer, watch
 * the room dropdown refuse them, assign them somewhere safe, then delete the
 * row — needs to write to the board, so it is opt-in:
 *
 *   $env:CQ_E2E_MUTATIONS=1; npx playwright test tests/e2e/conflict-ui.spec.js
 *
 * It always cleans up after itself, and it is the only mutating spec in the run.
 */
import { expect, test } from '@playwright/test'
import { PREFIX, rest } from '../db/env.mjs'

const EMAIL = process.env.ADMIN_EMAIL
const PASSWORD = process.env.ADMIN_PASSWORD
const ALLOW_WRITES = process.env.CQ_E2E_MUTATIONS === '1'

/** The room that is really staffed, from the project's own data. */
const STAFFED_ROOM = 'A320'
const STAFFED_INTERVIEWER = 'daniel'

const signIn = async (page) => {
  await page.goto('/login')
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/admin', { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Not Arrived', exact: true })).toBeVisible()
}

const openAddModal = async (page) => {
  await page.getByRole('button', { name: 'Add Candidate' }).click()
  const modal = page.locator('div.fixed.inset-0.z-50')
  await expect(modal).toBeVisible()
  return modal
}

const cardFor = (page, name) =>
  page.locator('section').filter({ hasText: name }).locator('article').filter({ hasText: name }).first()

test.describe('conflict of interest — the modal', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, 'ADMIN_EMAIL / ADMIN_PASSWORD are not set in .env')
    await signIn(page)
  })

  test('offers an Interviewer conflicts field, and explains it', async ({ page }) => {
    const modal = await openAddModal(page)

    await expect(modal.getByText('Interviewer conflicts')).toBeVisible()
    const field = modal.getByPlaceholder('daniel, Dana')
    await expect(field).toBeVisible()
    await expect(modal.getByText(/Comma-separated/)).toBeVisible()
    await expect(modal.getByText(/Matching ignores case and extra spaces/)).toBeVisible()

    // Free text as typed — the tidying happens on save.
    await field.fill('  daniel , DANA ,daniel ')
    await expect(field).toHaveValue('  daniel , DANA ,daniel ')

    await modal.getByRole('button', { name: 'Cancel' }).click()
    await expect(modal).toBeHidden()
  })

  test('round-trips an existing candidate’s restrictions through Edit', async ({ page }) => {
    const firstCard = page.locator('article').first()
    await firstCard.getByRole('button', { name: 'Edit candidate' }).click()

    const modal = page.locator('div.fixed.inset-0.z-50')
    await expect(modal.getByRole('heading', { name: 'Edit candidate' })).toBeVisible()
    // Nobody on the live board is restricted, so the field comes back empty —
    // but it must be populated from the record rather than blanked by accident.
    await expect(modal.getByPlaceholder('daniel, Dana')).toHaveValue('')

    await modal.getByRole('button', { name: 'Cancel' }).click()
    await expect(modal).toBeHidden()
  })
})

test.describe('conflict of interest — the full round trip', () => {
  test.skip(!ALLOW_WRITES, 'set CQ_E2E_MUTATIONS=1 to run the writing scenario')
  test.describe.configure({ mode: 'serial' })

  const name = `ZZQA-E2E-${Date.now()}`

  // Self-healing: a failed run must not leave a row behind for the dispatcher
  // to wonder about.
  test.beforeAll(async () => {
    if (ALLOW_WRITES) await rest(`candidates?name=like.${PREFIX}E2E-*`, { method: 'DELETE' })
  })
  test.afterAll(async () => {
    if (ALLOW_WRITES) await rest(`candidates?name=like.${PREFIX}E2E-*`, { method: 'DELETE' })
  })

  test('a restricted candidate is never sent to that interviewer', async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, 'ADMIN_EMAIL / ADMIN_PASSWORD are not set in .env')
    page.on('dialog', (dialog) => dialog.accept())

    await signIn(page)

    /* --- create ------------------------------------------------------- */
    const modal = await openAddModal(page)
    await modal.getByPlaceholder('ישראל ישראלי').fill(name)
    await modal.getByPlaceholder('42').fill('9001')
    await modal.getByPlaceholder('050-0000000').fill('050-0000000')
    await modal.getByPlaceholder('daniel, Dana').fill(`${STAFFED_INTERVIEWER}, Dana`)
    await modal.getByRole('button', { name: 'Add candidate' }).click()
    await expect(modal).toBeHidden()

    const card = cardFor(page, name)
    await expect(card).toBeVisible()
    // The database sorts the constraint list, so the order it is shown in is
    // its own — both names must simply be there, in the admin's own casing.
    await expect(card).toContainText(/no .*daniel/i)
    await expect(card).toContainText(/no .*Dana/)

    /* --- arrive ------------------------------------------------------- */
    await card.getByLabel('Arrived').check()
    await expect(card.getByRole('button', { name: /Auto-assign/ })).toBeVisible()

    /* --- the manual path refuses the room ----------------------------- */
    const roomPicker = card.getByLabel('Assigned room')
    const blocked = roomPicker.locator('option', { hasText: STAFFED_ROOM })
    await expect(blocked).toBeDisabled()
    await expect(blocked).toContainText('(Blocked: Conflict)')

    // A room nobody is assigned to is still available.
    const a206 = roomPicker.locator('option', { hasText: 'A206' })
    await expect(a206).toBeEnabled()

    /* --- Auto-Assign skips the restricted room ------------------------ */
    const roomOptions = await roomPicker.locator('option').evaluateAll((options) =>
      options.filter((o) => o.disabled).map((o) => o.textContent.trim()),
    )
    expect(roomOptions).toContain(`${STAFFED_ROOM} · Debate (Blocked: Conflict)`)

    await card.getByRole('button', { name: /Auto-assign/ }).click()
    // Either interview is a legitimate answer now: a candidate who owes both is
    // routed to whichever track is idle, so the toast must not be assumed to
    // say Debate.
    await expect(page.getByText(/Candidate assigned to .* for (Debate|Personal) Interview/)).toBeVisible({
      timeout: 20_000,
    })

    // Whatever it chose, it was not the restricted room.
    const restrictedValue = await blocked.getAttribute('value')
    expect(await roomPicker.inputValue()).not.toBe(restrictedValue)
    expect(await roomPicker.inputValue()).not.toBe('')

    /* --- and it can always be released -------------------------------- */
    await card.getByRole('button', { name: 'Delete candidate' }).click()
    await expect(cardFor(page, name)).toHaveCount(0)
  })
})
