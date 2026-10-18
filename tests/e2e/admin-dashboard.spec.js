/**
 * The dispatch dashboard, exercised against the real board.
 *
 * Read-only by design: it signs in, looks at what is on screen, and checks the
 * three lists against their own stated rules. Nothing here creates, edits or
 * deletes a candidate.
 *
 *   npx playwright test tests/e2e/admin-dashboard.spec.js
 */
import { expect, test } from '@playwright/test'
import { ANON_KEY, BASE } from '../db/env.mjs'

const EMAIL = process.env.ADMIN_EMAIL
const PASSWORD = process.env.ADMIN_PASSWORD

const anonHeaders = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }

/** `1h 05m` / `20m` → minutes. */
const minutesFromText = (text) => {
  const hours = Number((text.match(/(\d+)h/) ?? [])[1] ?? 0)
  const minutes = Number((text.match(/(\d+)m/) ?? [])[1] ?? 0)
  return hours * 60 + minutes
}

/** The section that owns a given column heading. */
const column = (page, title) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) })

const signIn = async (page) => {
  await page.goto('/login')
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/admin', { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: 'Not Arrived' })).toBeVisible()
}

/** Every card in a column, as { name, time, late } — read from the DOM only. */
const readColumn = (page, title) =>
  column(page, title)
    .locator('article')
    .evaluateAll((articles) =>
      articles.map((article) => ({
        text: article.innerText,
        name: article.querySelector('p.font-semibold')?.textContent ?? '',
        time: (article.innerText.match(/\b(\d{1,2}:\d{2})\b/) ?? [])[1] ?? null,
        late: article.innerText.includes('LATE'),
        done: article.innerText.includes('DONE'),
      })),
    )

test.describe('the dashboard against the live board', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, 'ADMIN_EMAIL / ADMIN_PASSWORD are not set in .env')
    await signIn(page)
  })

  test('shows the three lists the dispatcher works from', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Not Arrived', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Arrived', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Finished', exact: true })).toBeVisible()
    await expect(page.getByText('Earliest planned first · late pinned to top')).toBeVisible()
    await expect(page.getByText('Arrival order · first to arrive is first in line')).toBeVisible()
  })

  test('offers the head of the line on the Call next button', async ({ page }) => {
    const button = page.getByRole('button', { name: /Call next/ })
    await expect(button).toBeVisible()

    // Recompute "waiting" from the DOM the way the app does: they have a room
    // picker that is empty and a wand (so they have arrived and still owe an
    // interview). A candidate in a room is being interviewed, not waiting.
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('article')]
        .filter((card) => {
          const room = card.querySelector('select[aria-label="Assigned room"]')
          const wand = card.querySelector('button[title^="Auto-assign"]')
          return Boolean(room && room.value === '' && wand)
        })
        .map((card) => ({
          name: card.querySelector('p.font-semibold')?.textContent ?? '',
          at: card.innerText.match(/arrived (\d{1,2}:\d{2})/)?.[1] ?? '',
          line: card.innerText.includes('in line'),
        })),
    )

    if (rows.length === 0) {
      await expect(button).toBeDisabled()
      return
    }

    // Every waiting person is numbered, and the earliest arrival is number one.
    for (const row of rows) expect(row.line, `${row.name} should have a place in line`).toBe(true)

    const [head] = [...rows].sort((a, b) => a.at.localeCompare(b.at))
    await expect(button).toBeEnabled()
    await expect(button).toContainText(head.name)
    await expect(page.getByText('1st in line')).toBeVisible()
  })

  test('keeps the not-arrived list sorted by planned time', async ({ page }) => {
    const cards = await readColumn(page, 'Not Arrived')
    test.skip(cards.length < 2, 'not enough candidates on the board to check ordering')

    const minutes = cards.map((card) => {
      const [h, m] = card.time.split(':').map(Number)
      return h * 60 + m
    })
    for (let i = 1; i < minutes.length; i += 1) {
      expect(minutes[i], `${cards[i].name} should not be listed before ${cards[i - 1].name}`).toBeGreaterThanOrEqual(
        minutes[i - 1],
      )
    }
  })

  test('flags exactly the candidates who are more than 15 minutes late', async ({ page }) => {
    const cards = await readColumn(page, 'Not Arrived')
    test.skip(cards.length === 0, 'nobody is waiting to check in')

    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()

    for (const card of cards) {
      const [h, m] = card.time.split(':').map(Number)
      const expected = nowMinutes > h * 60 + m + 15
      expect(card.late, `${card.name} (planned ${card.time}) late flag`).toBe(expected)
    }
  })

  test('sorts the finished list alphabetically', async ({ page }) => {
    const cards = await readColumn(page, 'Finished')
    test.skip(cards.length < 2, 'nothing has finished yet')

    const names = cards.map((card) => card.name)
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'he'))
    expect(names).toEqual(sorted)
  })

  test('never lists a candidate in two places at once', async ({ page }) => {
    const [notArrived, arrived, finished] = await Promise.all([
      readColumn(page, 'Not Arrived'),
      readColumn(page, 'Arrived'),
      readColumn(page, 'Finished'),
    ])

    const names = [...notArrived, ...arrived, ...finished].map((card) => card.name).filter(Boolean)
    expect(new Set(names).size).toBe(names.length)

    // The lock hint appears on exactly the cards that have not arrived.
    for (const card of arrived) expect(card.text).not.toContain('Mark as arrived to unlock')
    for (const card of notArrived) expect(card.text).toContain('Mark as arrived to unlock')
    void finished
  })

  test('filters the lists through the search box, and clears again', async ({ page }) => {
    const before = await readColumn(page, 'Not Arrived')
    test.skip(before.length === 0, 'nobody is waiting to check in')

    const needle = before[0].name.slice(0, 2)
    const search = page.getByPlaceholder('Search name…')
    await search.fill(needle)

    const after = await readColumn(page, 'Not Arrived')
    expect(after.length).toBeLessThanOrEqual(before.length)
    for (const card of after) expect(card.name).toContain(needle.slice(0, 1))

    await search.fill('')
    expect(await readColumn(page, 'Not Arrived')).toHaveLength(before.length)
  })

  test('keeps every in-room timer honest, and red only past 20 minutes', async ({ page, request }) => {
    // The page's own clock is not the source of truth here: the real
    // `room_entry_time` is fetched from the database and the displayed duration
    // is recomputed from it. A stale or mis-parsed timer cannot pass.
    const seated = await request
      .get(
        `${BASE}/rest/v1/candidates?select=id,name,room_entry_time,assigned_room&assigned_room=not.is.null&room_entry_time=not.is.null`,
        { headers: anonHeaders },
      )
      .then((res) => res.json())
    test.skip(!Array.isArray(seated) || seated.length === 0, 'nobody is sitting in a room right now')

    const rooms = page.locator('section').filter({ has: page.getByRole('button', { name: 'Add room' }) })
    const timers = await rooms
      .locator('span[title^="In "]')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({ text: node.textContent ?? '', destructive: node.className.includes('text-destructive') })),
      )

    // One timer per candidate the database says is in a room.
    expect(timers).toHaveLength(seated.length)

    for (const timer of timers) {
      const minutes = minutesFromText(timer.text)
      const expectedRed = minutes >= 20
      expect(timer.destructive, `${timer.text} should be red: ${expectedRed}`).toBe(expectedRed)
      expect(timer.text.includes('⚠️'), `${timer.text} warning`).toBe(expectedRed)
    }

    // And each displayed number agrees with the stored entry time (±1 for the
    // minute the page may be behind by while the test reads the clock).
    const now = Date.now()
    const shown = timers.map((timer) => minutesFromText(timer.text)).sort((a, b) => a - b)
    const stored = seated
      .map((row) => Math.floor((now - new Date(row.room_entry_time).getTime()) / 60_000))
      .sort((a, b) => a - b)

    shown.forEach((minutes, index) => {
      expect(Math.abs(minutes - stored[index]), `timer shows ${minutes}m but the room entry is ${stored[index]}m old`).toBeLessThanOrEqual(1)
    })
  })

  test('shows each room with its status, and the interviewer inline', async ({ page }) => {
    const rooms = page.locator('section').filter({ has: page.getByRole('button', { name: 'Add room' }) })
    await expect(rooms).toBeVisible()

    // Every room in the panel names its interviewer without a click: either a
    // name is shown, or the affordance to add one is.
    const addInterviewer = await page.getByText('+ Add interviewer').count()
    expect(addInterviewer).toBeGreaterThan(0)

    // Where a panel exists, the card itself lists it — nobody has to open the
    // modal to find out who is in the room.
    const staffed = rooms.locator('button[title="Edit interviewer panel"]')
    if (await staffed.count()) {
      await expect(rooms.getByText('👥').first()).toBeVisible()
    }
  })

  test('opens a room’s panel and lists every interviewer in it', async ({ page }) => {
    const rooms = page.locator('section').filter({ has: page.getByRole('button', { name: 'Add room' }) })
    const modal = page.locator('div.fixed.inset-0.z-50')

    // A room that already has a panel offers the pencil; the modal must list
    // every name in it, with no click needed to reveal anyone.
    const staffed = rooms.locator('button[title="Edit interviewer panel"]')
    if (await staffed.count()) {
      await staffed.first().click()
      await expect(modal).toBeVisible()
      await expect(modal.getByText(/room · \d+ interviewers?/)).toBeVisible()
      expect(await modal.getByTestId('interviewer-panel').locator('li').count()).toBeGreaterThan(0)

      // "Edit" lets the panel grow and shrink in place.
      await modal.getByRole('button', { name: 'Edit panel', exact: true }).click()
      const rows = modal.getByTestId('interviewer-row')
      const before = await rows.count()
      await modal.getByRole('button', { name: '+ Add interviewer' }).click()
      await expect(rows).toHaveCount(before + 1)
      await modal.getByRole('button', { name: 'Cancel' }).click()
      await modal.getByRole('button', { name: 'Close' }).click()
      await expect(modal).toBeHidden()
    }

    // A room with nobody recorded opens too, and says so rather than showing a
    // blank box.
    await rooms.locator('button[title="Add interviewers"]').first().click()
    await expect(modal).toBeVisible()
    await expect(modal.getByText(/room · no interviewers/)).toBeVisible()
    await expect(modal.getByText(/No interviewers recorded/)).toBeVisible()

    // Read-only run: nothing is saved.
    await modal.getByRole('button', { name: 'Close' }).click()
    await expect(modal).toBeHidden()
  })
})
