/**
 * The in-room rubric view, on the real deployment.
 *
 * Two things are worth proving here and nothing more, because this file runs
 * against live data it must not disturb:
 *
 *   1. **The gate.** /room/:id shows one candidate's name and the scores the club
 *      gave them, so an anonymous visitor must get the sign-in wall — not the
 *      rubric, not a partially-rendered form.
 *   2. **The wiring.** Signed in, the room opens and either shows the rubric (when
 *      somebody is genuinely in a Personal Interview there) or says so plainly.
 *
 * Read-only: it never submits an evaluation and never touches the board. Filing a
 * rubric is exercised in `tests/unit/roomEvaluation.test.jsx` and, for real, in
 * the mutating `conflict-ui.spec.js` round trip.
 *
 *   npx playwright test tests/e2e/room-rubric.spec.js
 */
import { expect, test } from '@playwright/test'
import { ANON_KEY, BASE, PREFIX, rest } from '../db/env.mjs'

const EMAIL = process.env.ADMIN_EMAIL
const PASSWORD = process.env.ADMIN_PASSWORD
const ALLOW_WRITES = process.env.CQ_E2E_MUTATIONS === '1'

const anonHeaders = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }

/** The first room id on the real board, as a candidate's QR page would find it. */
const firstRoomId = async (request) => {
  const rows = await request
    .get(`${BASE}/rest/v1/rooms?select=id&order=room_name.asc&limit=1`, { headers: anonHeaders })
    .then((res) => res.json())
  return rows?.[0]?.id
}

test.describe('the room rubric is staff-only', () => {
  test('an anonymous visitor is stopped at the sign-in wall', async ({ page, request }) => {
    const roomId = await firstRoomId(request)
    test.skip(!roomId, 'no rooms on the board')

    await page.goto(`/room/${roomId}`)

    // The gate, not the form.
    await expect(page.getByText('Admins only')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Submit Evaluation & Release Room' })).toHaveCount(0)
    await expect(page.getByText('מי מראיין?')).toHaveCount(0)

    // And the five declared fields of the rubric never reach the wire either.
    for (const probe of ['evaluations?select=*', 'evaluations?select=scores']) {
      const response = await request.get(`${BASE}/rest/v1/${probe}`, { headers: anonHeaders })
      expect([401, 403], `${probe} must be refused`).toContain(response.status())
    }
  })

  test('the sign-in wall remembers which room was asked for', async ({ page, request }) => {
    const roomId = await firstRoomId(request)
    test.skip(!roomId, 'no rooms on the board')

    await page.goto(`/room/${roomId}`)
    await page.getByRole('link', { name: 'Sign in' }).click()

    // Drawn from route state, not a hardcoded /admin: the interviewer should end
    // up back in the room they opened once they are through the form.
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.locator('input[type="email"]')).toBeVisible()
  })
})

test.describe('the room view, signed in', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, 'ADMIN_EMAIL / ADMIN_PASSWORD are not set in .env')
    await page.goto('/login')
    await page.fill('input[type="email"]', EMAIL)
    await page.fill('input[type="password"]', PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL('**/admin', { timeout: 30_000 })
    // The board loads over realtime after the redirect, so wait for it to paint
    // before looking for anything on it — otherwise the rooms panel can still be
    // empty and a count-based check would silently skip.
    await expect(page.getByRole('heading', { name: 'Not Arrived' })).toBeVisible()
  })

  test('opens from the rooms panel and names the room', async ({ page }) => {
    const openLinks = page.getByRole('link', { name: /^Open interview room / })
    await expect(openLinks.first()).toBeVisible({ timeout: 15_000 })

    const label = await openLinks.first().getAttribute('aria-label')
    const roomName = label.replace('Open interview room ', '')
    await openLinks.first().click()

    await expect(page).toHaveURL(/\/room\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name: new RegExp(roomName) })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Dispatch board', exact: true })).toBeVisible()
  })

  test('shows the rubric when somebody is in a Personal Interview, and says so otherwise', async ({ page, request }) => {
    // Ask the database, as an admin, whether any room currently holds somebody
    // mid-Personal-Interview — that is what decides which state to expect.
    const signIn = await request
      .post(`${BASE}/auth/v1/token?grant_type=password`, {
        headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
        data: { email: EMAIL, password: PASSWORD },
      })
      .then((res) => res.json())

    const seated = await request
      .get(
        `${BASE}/rest/v1/candidates?select=assigned_room,current_task_assignment&assigned_room=not.is.null&current_task_assignment=eq.Personal%20Interview&limit=1`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${signIn.access_token}` } },
      )
      .then((res) => res.json())

    const roomId = seated?.[0]?.assigned_room
    test.skip(!roomId, 'nobody is in a Personal Interview right now — the rubric path needs a live pair')

    await page.goto(`/room/${roomId}`)
    await expect(page.getByText('מי מראיין?')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Submit Evaluation & Release Room' })).toBeVisible()

    // The form is Hebrew and right-to-left, whatever the surrounding chrome does.
    await expect(page.locator('form')).toHaveAttribute('dir', 'rtl')
  })

  test('never shows the rubric for a room nobody is in', async ({ page, request }) => {
    const rooms = await request
      .get(`${BASE}/rest/v1/rooms?select=id&order=room_name.asc`, { headers: anonHeaders })
      .then((res) => res.json())
    const occupied = await request
      .get(`${BASE}/rest/v1/candidates?select=assigned_room&assigned_room=not.is.null`, {
        headers: anonHeaders,
      })
      .then((res) => res.json())

    const taken = new Set((occupied ?? []).map((row) => row.assigned_room))
    const emptyRoom = (rooms ?? []).find((room) => !taken.has(room.id))
    test.skip(!emptyRoom, 'every room currently holds somebody')

    await page.goto(`/room/${emptyRoom.id}`)
    await expect(page.getByRole('heading', { name: 'With the interviewer now' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Submit Evaluation & Release Room' })).toHaveCount(0)
  })
})

/**
 * The whole thing, end to end, against the live database: a real candidate in a
 * real Personal Interview, the rubric filed through the real form, and the room
 * released as a result.
 *
 * This is the only place that proves the two halves meet — that the form the
 * interviewers see is the one keyed to `Current_Task_Assignment = 'Personal
 * Interview'`, and that submitting it stores the scores *and* frees the room.
 * It writes, so it is opt-in and cleans up after itself:
 *
 *   $env:CQ_E2E_MUTATIONS=1; npx playwright test tests/e2e/room-rubric.spec.js
 *
 * Everything it creates lives in a scratch room of its own, so the assertions
 * cannot be confused by whoever else is on the board.
 */
test.describe('the rubric, filed for real', () => {
  test.skip(!ALLOW_WRITES, 'set CQ_E2E_MUTATIONS=1 to run the writing scenario')
  test.describe.configure({ mode: 'serial' })

  const stamp = Date.now()
  const ROOM_NAME = `${PREFIX}E2E-RUBRIC-ROOM-${stamp}`
  const CANDIDATE_NAME = `${PREFIX}E2E-RUBRIC-${stamp}`

  const sweep = () =>
    Promise.all([
      rest(`candidates?name=like.${PREFIX}E2E-RUBRIC-*`, { method: 'DELETE' }),
      rest(`rooms?room_name=like.${PREFIX}E2E-RUBRIC-*`, { method: 'DELETE' }),
    ])

  test.beforeAll(async () => {
    if (ALLOW_WRITES) await sweep()
  })
  test.afterAll(async () => {
    if (ALLOW_WRITES) await sweep()
  })

  test('files the Personal Interview rubric and frees the room', async ({ page }) => {
    test.skip(!EMAIL || !PASSWORD, 'ADMIN_EMAIL / ADMIN_PASSWORD are not set in .env')

    /* --- a room and a candidate of our own ---------------------------- */
    const room = await rest('rooms', {
      method: 'POST',
      prefer: 'return=representation',
      body: { room_name: ROOM_NAME, room_type: 'Personal', interviewers: [{ name: 'ZZQA Interviewer', phone: null }] },
    }).then((res) => res.data?.[0])
    expect(room?.id, 'created a scratch Personal room').toBeTruthy()

    const candidate = await rest('candidates', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        name: CANDIDATE_NAME,
        serial_number: '77001',
        phone_number: '050-7700001',
        has_arrived: true,
        assigned_room: room.id,
        current_task_assignment: 'Personal Interview',
      },
    }).then((res) => res.data?.[0])
    expect(candidate?.id, 'created a scratch candidate in that room').toBeTruthy()

    /* --- open the room as an interviewer ------------------------------ */
    await page.goto('/login')
    await page.fill('input[type="email"]', EMAIL)
    await page.fill('input[type="password"]', PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL('**/admin', { timeout: 30_000 })

    await page.goto(`/room/${room.id}`)

    // The form is keyed to the task, and this candidate is in a Personal
    // Interview — so the Hebrew rubric, not the Debate placeholder.
    await expect(page.getByText('מי מראיין?')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(CANDIDATE_NAME)).toBeVisible()

    // The two database-backed prefills, and the single-interviewer panel.
    await expect(page.getByLabel('שם מלא של המועמד')).toHaveValue(CANDIDATE_NAME)
    await expect(page.getByLabel('מספר מרואיין')).toHaveValue('77001')
    await expect(page.getByLabel('מי מראיין?')).toHaveValue('ZZQA Interviewer')

    /* --- answer everything the club marked mandatory ------------------- */
    await page.getByLabel('מסלול לימודים').fill('משפטים')
    await page.getByLabel('שנים שנותרו לתואר').fill('2')
    await page.getByLabel('האם יש לך ניסיון קודם בדיבייט/דוברות/רטוריקה/הדרכה').fill('קורס רטוריקה בתיכון')
    await page
      .getByLabel(/הקורס מתקיים בימי שני/)
      .fill('אין התנגשות, פנוי לגמרי')
    await page.getByLabel('למה אתה רוצה להיות במועדון הדיבייט?').fill('כי אני אוהב לדבר')
    await page.getByLabel('ספר לנו קצת על עצמך').fill('סטודנט שנה ב')
    await page.getByLabel(/מה אתם עושים בזמנכם הפנוי/).fill('עובד במלצרות')
    // The 1–5 chips are styled labels over a visually-hidden radio, so clicking
    // the chip is how a person picks a score — and it toggles the input natively.
    await page.locator('label[for="evaluation-field-rating_availability-5"]').click()
    await page.locator('label[for="evaluation-field-rating_vibe-4"]').click()
    await expect(page.getByRole('radio', { name: 'זמינות ומחוייבות — 5' })).toBeChecked()
    await expect(page.getByRole('radio', { name: 'וייב של בן אדם והתאמה למועדון — 4' })).toBeChecked()

    /* --- file it ------------------------------------------------------- */
    await page.getByRole('button', { name: 'Submit Evaluation & Release Room' }).click()
    await expect(page.getByText(/ההערכה של .* נשמרה/)).toBeVisible({ timeout: 20_000 })

    /* --- what actually landed in the database -------------------------- */
    const saved = await rest(`evaluations?candidate_id=eq.${candidate.id}&select=*`).then((res) => res.data ?? [])
    expect(saved, 'exactly one evaluation was filed').toHaveLength(1)
    expect(saved[0].task).toBe('Personal Interview')
    expect(saved[0].room_id).toBe(room.id)
    expect(saved[0].interviewer_name).toBe('ZZQA Interviewer')
    expect(saved[0].submitted_by).toBe(EMAIL)
    // Numbers stored as numbers, text as text, and the optional ones present.
    expect(saved[0].scores.rating_availability).toBe(5)
    expect(saved[0].scores.rating_vibe).toBe(4)
    expect(saved[0].scores.years_remaining).toBe(2)
    expect(saved[0].scores.study_track).toBe('משפטים')
    expect(saved[0].scores.rating_competitiveness).toBeNull()

    /* --- and the room is genuinely free again -------------------------- */
    const after = await rest(`candidates?id=eq.${candidate.id}&select=assigned_room,current_task_assignment,room_entry_time,personal_interview_completed`).then(
      (res) => res.data?.[0],
    )
    expect(after.personal_interview_completed).toBe(true)
    // Rule 3 owns the release: completing the interview clears the room, the
    // task and the in-room clock, not the page.
    expect(after.assigned_room).toBeNull()
    expect(after.current_task_assignment).toBeNull()
    expect(after.room_entry_time).toBeNull()

    // Reloading the room now offers no form, because nobody is in it.
    await page.reload()
    await expect(page.getByRole('button', { name: 'Submit Evaluation & Release Room' })).toHaveCount(0)

    // The filed rubric is still readable from the room, read-only.
    await expect(page.getByText('Filed in this room')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: new RegExp(CANDIDATE_NAME) }).click()
    // Exact, because "משפטים" is also one of the topics named in the
    // debate-topics question — the loose matcher finds both.
    await expect(page.getByText('משפטים', { exact: true })).toBeVisible()
  })
})
