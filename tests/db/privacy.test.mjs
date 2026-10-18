/**
 * Strict privacy verification — what an anonymous visitor can and cannot read.
 *
 * The candidate page is the only surface a stranger can open, and the anon key
 * ships inside the bundle. So the question is not "what does our page request"
 * but "what could a curious candidate request". These tests ask the REST API
 * directly, with the publishable key, the way a candidate's browser could.
 *
 * Read-only apart from signing in as the admin.
 *
 *   npm run test:db
 */
import { ANON_KEY, BASE, cleanupScratch, configured, harness, rest, SECRET_KEY } from './env.mjs'

if (!configured) {
  console.log('ℹ️  No Supabase credentials in .env — skipping the privacy tests.')
  process.exit(0)
}

const t = harness('Strict privacy (live database)')

/** Call the REST API as an anonymous visitor. */
const asAnon = (path, init = {}) => rest(path, { ...init, key: ANON_KEY, bearer: ANON_KEY })

/** The exact query the public page issues for the candidate's own row. */
const PUBLIC_CANDIDATE_SELECT =
  'name, planned_time, arrival_time, assigned_room, current_task_assignment, debate_interview_completed, personal_interview_completed'

try {
  /* ------------------------- interviewer data on rooms -------------------- */
  {
    const allowed = await asAnon('rooms?select=id,room_name,room_type&limit=1')
    t.equal('anon CAN read the three public room columns', allowed.status, 200)

    // The single-interviewer columns the first release used are gone entirely,
    // folded into `interviewers`; the panel is the only staff data left to guard.
    for (const column of ['interviewers', '*']) {
      const blocked = await asAnon(`rooms?select=${column}`)
      t.ok(
        `anon CANNOT read rooms.${column}`,
        blocked.status === 401 || blocked.status === 403,
        `status ${blocked.status}`,
      )
    }

    const gone = await asAnon('rooms?select=interviewer_name')
    t.ok(
      'the retired singular columns no longer exist at all',
      gone.status >= 400,
      `status ${gone.status}`,
    )

    const mixed = await asAnon('rooms?select=room_name,interviewers')
    t.ok(
      'anon cannot smuggle interviewers in beside a public column',
      mixed.status === 401 || mixed.status === 403,
      `status ${mixed.status}`,
    )

    // Belt and braces: even the allowed read must not happen to carry the panel.
    const publicRead = await asAnon('rooms?select=id,room_name,room_type')
    t.ok(
      'the columns anon may read never include the panel',
      (publicRead.data ?? []).every((room) => !('interviewers' in room)),
      JSON.stringify(publicRead.data?.[0] ?? {}),
    )
  }

  /* ------------------------ the candidate's own row ----------------------- */
  {
    const all = await rest('candidates?select=id&limit=1')
    const id = all.data?.[0]?.id
    t.ok('(found a real candidate to query)', Boolean(id))

    if (id) {
      const own = await asAnon(`candidates?select=${PUBLIC_CANDIDATE_SELECT}&id=eq.${id}`)
      t.equal('the public page’s candidate query works for anon', own.status, 200)

      const keys = Object.keys(own.data?.[0] ?? {})
      t.ok(
        'and returns exactly the seven fields the page asked for',
        keys.length === 7,
        keys.join(', '),
      )
      for (const forbidden of ['serial_number', 'phone_number', 'room_entry_time', 'interviewer_constraints']) {
        t.ok(`no ${forbidden} in the payload a candidate receives`, !keys.includes(forbidden))
      }
    }
  }

  /* ---------------------------- write protection -------------------------- */
  {
    // RLS filters an unpermitted write silently — 204 with zero rows changed —
    // so the honest assertion is about the row, not the status code.
    const victim = await rest('rooms', {
      method: 'POST',
      prefer: 'return=representation',
      body: { room_name: 'ZZQA-ANON-VICTIM', room_type: 'Debate', interviewers: [{ name: 'safe', phone: null }] },
    })
    const victimId = victim.data?.[0]?.id

    if (!victimId) {
      t.ok('(could create the anon test room)', false, JSON.stringify(victim.data))
    } else {
      await asAnon(`rooms?id=eq.${victimId}`, {
        method: 'PATCH',
        body: { interviewers: [{ name: 'attacker', phone: null }] },
      })
      const afterPatch = await rest(`rooms?id=eq.${victimId}&select=interviewers`)
      t.equal('anon cannot rewrite an interviewer', afterPatch.data?.[0]?.interviewers?.[0]?.name, 'safe')

      await asAnon(`rooms?id=eq.${victimId}`, { method: 'DELETE' })
      const afterDelete = await rest(`rooms?id=eq.${victimId}&select=id`)
      t.equal('anon cannot delete a room', afterDelete.data?.length, 1)

      await rest(`rooms?id=eq.${victimId}`, { method: 'DELETE' })
    }

    const tempCand = await rest('candidates', {
      method: 'POST',
      prefer: 'return=representation',
      body: { name: 'ZZQA-ANON-CAND', serial_number: 'ZZQA-ANON-CAND', has_arrived: false },
    })
    const candId = tempCand.data?.[0]?.id

    if (candId) {
      await asAnon(`candidates?id=eq.${candId}`, { method: 'PATCH', body: { has_arrived: true } })
      const row = await rest(`candidates?id=eq.${candId}&select=has_arrived`)
      t.equal('anon cannot modify a candidate', row.data?.[0]?.has_arrived, false)

      await asAnon(`candidates?id=eq.${candId}`, { method: 'DELETE' })
      const still = await rest(`candidates?id=eq.${candId}&select=id`)
      t.equal('anon cannot delete a candidate', still.data?.length, 1)

      await rest(`candidates?id=eq.${candId}`, { method: 'DELETE' })
    }

    const createRoom = await asAnon('rooms', { method: 'POST', body: { room_name: 'ZZQA-ANON', room_type: 'Debate' } })
    t.ok('anon cannot create a room', createRoom.status >= 400, `status ${createRoom.status}`)

    const insertCandidate = await asAnon('candidates', {
      method: 'POST',
      body: { name: 'ZZQA-ANON', serial_number: 'ZZQA-ANON', has_arrived: false },
    })
    t.ok('anon cannot insert a candidate', insertCandidate.status >= 400, `status ${insertCandidate.status}`)
  }

  /* ------------------------------ the admin list -------------------------- */
  {
    const admins = await asAnon('allowed_admins?select=email')
    const leaked = Array.isArray(admins.data) ? admins.data.length : 0
    t.equal('anon cannot read the admin list', leaked, 0)
  }

  /* --------------------------- admins are unaffected ---------------------- */
  {
    const email = process.env.ADMIN_EMAIL
    const password = process.env.ADMIN_PASSWORD

    if (!email || !password) {
      console.log('  ℹ️  ADMIN_EMAIL / ADMIN_PASSWORD missing — skipping the signed-in checks.')
    } else {
      const signIn = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }).then((r) => r.json())

      if (!signIn.access_token) {
        t.ok('could sign in as the admin', false, JSON.stringify(signIn))
      } else {
        const asAdmin = (path) => rest(path, { key: ANON_KEY, bearer: signIn.access_token })

        const interviewers = await asAdmin('rooms?select=room_name,interviewers')
        t.equal('a signed-in admin CAN read interviewer details', interviewers.status, 200)
        t.ok(
          'and the panel is really there (a room is staffed)',
          Array.isArray(interviewers.data) &&
            interviewers.data.some((room) => Array.isArray(room.interviewers) && room.interviewers.length > 0),
          JSON.stringify(interviewers.data ?? []),
        )

        const everything = await asAdmin('rooms?select=*')
        t.equal('a signed-in admin can still select *', everything.status, 200)
      }
    }
  }

  /* ------------------------------- sanity --------------------------------- */
  {
    const stillThere = await asAnon('rooms?select=room_name')
    t.ok('the public page still has its rooms after all of the above', stillThere.status === 200 && stillThere.data?.length > 0)
    t.ok('(secret key present for the privileged checks)', Boolean(SECRET_KEY))
  }
} catch (error) {
  console.log(`\n❌ ${error?.stack || error}`)
  process.exit(1)
} finally {
  await cleanupScratch()
}

process.exit(t.report() === 0 ? 0 : 1)
