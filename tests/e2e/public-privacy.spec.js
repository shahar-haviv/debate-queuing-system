/**
 * The candidate's page, checked on the wire and through the API.
 *
 * A candidate holds the publishable key — it is inside the bundle they just
 * downloaded — so "our page doesn't ask for it" is only half the story. These
 * tests prove both halves: the page never *requests* interviewer data, and the
 * API refuses to hand it over if somebody asks directly.
 */
import { expect, test } from '@playwright/test'
import { ANON_KEY, BASE } from '../db/env.mjs'

const anonHeaders = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }

/** Any of the three states the public page can be in. */
const ANY_STATE = /Please proceed to|you are in the queue|All done/

test.describe('the candidate page is a dead end for staff data', () => {
  test('never requests interviewer data, and cannot fetch it either', async ({ page, request }) => {
    const restRequests = []
    const restBodies = []

    page.on('request', (req) => {
      if (req.url().includes('/rest/v1/')) restRequests.push(decodeURIComponent(req.url()))
    })
    page.on('response', async (res) => {
      if (!res.url().includes('/rest/v1/')) return
      try {
        restBodies.push(await res.text())
      } catch {
        /* a redirect or an aborted response — nothing to inspect */
      }
    })

    // Pick a real candidate, exactly as a candidate with a QR code would.
    const rows = await request
      .get(`${BASE}/rest/v1/candidates?select=id,serial_number,phone_number&order=created_at.asc&limit=1`, {
        headers: anonHeaders,
      })
      .then((res) => res.json())
    const candidate = rows[0]
    expect(candidate?.id).toBeTruthy()

    await page.goto(`/candidate/${candidate.id}`)
    await expect(page.locator('body')).toContainText(ANY_STATE)

    /* 1. What the page asked for. ------------------------------------- */
    for (const url of restRequests) {
      expect(url, 'no request may mention interviewers').not.toContain('interviewer')
    }

    const roomRequests = restRequests.filter((url) => url.includes('/rooms'))
    for (const url of roomRequests) {
      expect(url).toContain('select=id,room_name,room_type')
    }

    /* 2. What the server sent back. ----------------------------------- */
    const body = restBodies.join('\n')
    expect(body).not.toContain('interviewers')
    expect(body).not.toContain('interviewer_name')
    expect(body).not.toContain('interviewer_phone')
    expect(body).not.toContain('room_entry_time')
    if (candidate.phone_number) {
      expect(page.locator('body')).not.toContainText(candidate.phone_number)
      expect(body).not.toContain(candidate.phone_number)
    }

    /* 3. What a curious candidate could do with the key. -------------- */
    const replay = await request.get(`${BASE}/rest/v1/rooms?select=interviewers`, { headers: anonHeaders })
    expect([401, 403]).toContain(replay.status())

    const smuggled = await request.get(`${BASE}/rest/v1/rooms?select=room_name,interviewers`, { headers: anonHeaders })
    expect([401, 403]).toContain(smuggled.status())

    const star = await request.get(`${BASE}/rest/v1/rooms?select=*`, { headers: anonHeaders })
    expect([401, 403]).toContain(star.status())

    // …while the three columns it legitimately needs still work.
    const allowed = await request.get(`${BASE}/rest/v1/rooms?select=id,room_name,room_type`, { headers: anonHeaders })
    expect(allowed.status()).toBe(200)
    expect((await allowed.json()).length).toBeGreaterThan(0)
  })

  test('carries no serial number, no logo and no staff chrome', async ({ page, request }) => {
    const rows = await request
      .get(`${BASE}/rest/v1/candidates?select=id,serial_number&order=created_at.asc&limit=5`, { headers: anonHeaders })
      .then((res) => res.json())

    for (const candidate of rows.slice(0, 3)) {
      await page.goto(`/candidate/${candidate.id}`)
      await expect(page.locator('body')).toContainText(ANY_STATE)

      expect(await page.locator('img').count()).toBe(0)
      expect(await page.getByText(/Debug/i).count()).toBe(0)
      if (candidate.serial_number) {
        expect(await page.locator('body').innerText()).not.toContain(`#${candidate.serial_number}`)
      }
    }
  })

  test('says so plainly when the link is wrong', async ({ page }) => {
    await page.goto('/candidate/00000000-0000-0000-0000-000000000000')
    await expect(page.getByText('Candidate not found')).toBeVisible()
  })
})
