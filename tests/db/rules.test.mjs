/**
 * Rules 1–7, executed against the live database.
 *
 * These are the guarantees that make the UI trustworthy: every one of them is
 * enforced by a Postgres trigger, so the only honest way to test them is to try
 * to break them through the REST API the way a misbehaving client would.
 *
 * Every row this script creates is named ZZQA-… and deleted in cleanup.
 *
 *   npm run test:db
 */
import {
  PREFIX,
  cleanupScratch,
  configured,
  createRoom,
  harness,
  insertOne,
  patchCandidate,
  readCandidate,
  rest,
  sleep,
} from './env.mjs'

if (!configured) {
  console.log('ℹ️  No Supabase credentials in .env — skipping the database tests.')
  process.exit(0)
}

const t = harness('Rules 1–7 (live database)')
let failures = 0

const stamp = Date.now()
const candName = `${PREFIX}CAND-${stamp}`

let candidate = null
let debateRoom = null
let personalRoom = null
let generalRoom = null
let staffedRoom = null

const roomId = (room) => room?.row?.id ?? null
const fresh = () => readCandidate(candidate.row.id)

try {
  await cleanupScratch()

  /* ------------------------------- fixtures ------------------------------- */
  debateRoom = await createRoom(`${PREFIX}DEB-${stamp}`, 'Debate')
  personalRoom = await createRoom(`${PREFIX}PER-${stamp}`, 'Personal')
  generalRoom = await createRoom(`${PREFIX}GEN-${stamp}`, 'General')

  if (!debateRoom.row || !personalRoom.row || !generalRoom.row) {
    console.log('❌ Could not create the scratch rooms:', debateRoom.data, personalRoom.data, generalRoom.data)
    process.exit(1)
  }

  candidate = await insertOne({ name: candName, serial_number: `${PREFIX}${stamp}`, has_arrived: false })
  if (!candidate.row) {
    console.log('❌ Could not create the scratch candidate:', candidate.data)
    process.exit(1)
  }
  t.ok('scratch rooms + candidate created', Boolean(candidate.row))

  /* --------------------------- Rule 2 — arrival --------------------------- */
  {
    await patchCandidate(candidate.row.id, { has_arrived: true })
    const row = await fresh()
    t.ok('Rule 2: ticking Arrived stamps arrival_time', Boolean(row.arrival_time), JSON.stringify(row.arrival_time))

    const direct = await insertOne({
      name: `${PREFIX}STAMP-${stamp}`,
      serial_number: `${PREFIX}S-${stamp}`,
      has_arrived: true,
    })
    t.ok('Rule 2: inserting an already-arrived candidate stamps it too', Boolean(direct.row?.arrival_time))
    await rest(`candidates?id=eq.${direct.row.id}`, { method: 'DELETE' })
  }

  /* ---------------------------- Rule 5 — clock ---------------------------- */
  {
    await patchCandidate(candidate.row.id, { assigned_room: roomId(debateRoom) })
    const row = await fresh()
    t.ok('Rule 5: putting a candidate in a room starts room_entry_time', Boolean(row.room_entry_time))

    const started = row.room_entry_time

    // A forged backdate must be ignored: the column is server-owned.
    await patchCandidate(candidate.row.id, { room_entry_time: '2020-01-01T00:00:00Z' })
    const forged = await fresh()
    t.ok(
      'Rule 5: a client cannot backdate the clock',
      new Date(forged.room_entry_time).getFullYear() !== 2020,
      `room_entry_time came back as ${forged.room_entry_time}`,
    )

    // Re-assigning the same room must NOT restart the timer.
    await sleep(1100)
    await patchCandidate(candidate.row.id, { assigned_room: roomId(debateRoom) })
    const same = await fresh()
    t.ok(
      'Rule 5: re-assigning the same room leaves the running timer alone',
      new Date(same.room_entry_time).getTime() === new Date(started).getTime(),
      `was ${started}, now ${same.room_entry_time}`,
    )

    // Moving rooms restarts it.
    await sleep(1100)
    await patchCandidate(candidate.row.id, { assigned_room: roomId(personalRoom) })
    const moved = await fresh()
    t.ok(
      'Rule 5: moving to a different room restarts the clock',
      new Date(moved.room_entry_time).getTime() > new Date(started).getTime(),
      `was ${started}, now ${moved.room_entry_time}`,
    )

    await patchCandidate(candidate.row.id, { assigned_room: null })
    t.equal('Rule 5: leaving a room clears the clock', (await fresh()).room_entry_time, null)

    await patchCandidate(candidate.row.id, { assigned_room: roomId(debateRoom) })
    t.ok('Rule 5: (re-seated for the next checks)', Boolean((await fresh()).room_entry_time))
  }

  /* ------------------------ Rule 6 — task follows room -------------------- */
  {
    // The client claims the wrong interview; the server must overrule it.
    await patchCandidate(candidate.row.id, {
      assigned_room: roomId(debateRoom),
      current_task_assignment: 'Personal Interview',
    })
    t.equal(
      'Rule 6: a Debate room forces a Debate Interview',
      (await fresh()).current_task_assignment,
      'Debate Interview',
    )

    await patchCandidate(candidate.row.id, { assigned_room: roomId(personalRoom), current_task_assignment: 'Debate Interview' })
    t.equal(
      'Rule 6: a Personal room forces a Personal Interview',
      (await fresh()).current_task_assignment,
      'Personal Interview',
    )

    // A General room implies nothing, so the admin's own choice survives.
    await patchCandidate(candidate.row.id, {
      assigned_room: roomId(generalRoom),
      current_task_assignment: 'Personal Interview',
    })
    t.equal(
      'Rule 6: a General room keeps the admin’s choice',
      (await fresh()).current_task_assignment,
      'Personal Interview',
    )

    // Insert path: a brand-new row with the wrong task is corrected too.
    const inserted = await insertOne({
      name: `${PREFIX}TASK-${stamp}`,
      serial_number: `${PREFIX}T-${stamp}`,
      has_arrived: true,
      assigned_room: roomId(debateRoom),
      current_task_assignment: 'Personal Interview',
    })
    t.equal(
      'Rule 6: the insert path is corrected as well',
      inserted.row?.current_task_assignment,
      'Debate Interview',
    )
    await rest(`candidates?id=eq.${inserted.row.id}`, { method: 'DELETE' })

    // Changing a room's type re-derives the task for whoever is standing in it.
    await patchCandidate(candidate.row.id, { assigned_room: roomId(debateRoom) })
    const before = (await fresh()).current_task_assignment
    await rest(`rooms?id=eq.${roomId(debateRoom)}`, { method: 'PATCH', body: { room_type: 'Personal' } })
    const after = await fresh()
    await rest(`rooms?id=eq.${roomId(debateRoom)}`, { method: 'PATCH', body: { room_type: 'Debate' } })
    t.ok(
      'Rule 6: retyping a room re-derives its occupants’ task',
      before === 'Debate Interview' && after.current_task_assignment === 'Personal Interview',
      `before ${before}, after ${after.current_task_assignment}`,
    )
  }

  /* --------------------------- Rule 3 — auto-release ---------------------- */
  {
    await patchCandidate(candidate.row.id, { assigned_room: roomId(debateRoom) })
    await patchCandidate(candidate.row.id, { debate_interview_completed: true })
    const row = await fresh()
    t.equal('Rule 3: completing the debate clears the room', row.assigned_room, null)
    t.equal('Rule 3: and the task', row.current_task_assignment, null)
    t.equal('Rule 3: and the clock', row.room_entry_time, null)

    await patchCandidate(candidate.row.id, { assigned_room: roomId(personalRoom) })
    await patchCandidate(candidate.row.id, { personal_interview_completed: true })
    t.equal('Rule 3: completing the personal interview clears it too', (await fresh()).assigned_room, null)
  }

  /* ----------------------------- Rule 4 — orphans ------------------------- */
  {
    await patchCandidate(candidate.row.id, { current_task_assignment: 'Debate Interview' })
    t.equal('Rule 4: a task with no room is normalised away', (await fresh()).current_task_assignment, null)

    // Deleting a room clears the task of anyone standing in it.
    const doomed = await createRoom(`${PREFIX}DOOMED-${stamp}`, 'Debate')
    await patchCandidate(candidate.row.id, { assigned_room: roomId(doomed) })
    const seated = await fresh()
    t.equal('Rule 4: (seated before the room is deleted)', seated.current_task_assignment, 'Debate Interview')

    await rest(`rooms?id=eq.${roomId(doomed)}`, { method: 'DELETE' })
    const orphaned = await fresh()
    t.equal('Rule 4: deleting a room clears the paired task', orphaned.current_task_assignment, null)
    t.equal('Rule 4: and the room assignment', orphaned.assigned_room, null)
  }

  /* ------------------------- Rule 1 — arrival lock ------------------------ */
  {
    await patchCandidate(candidate.row.id, { has_arrived: true })
    await patchCandidate(candidate.row.id, { assigned_room: roomId(debateRoom), debate_interview_completed: true })
    await patchCandidate(candidate.row.id, { personal_interview_completed: true })

    // Re-arrive and take a room, then un-tick Arrived.
    await patchCandidate(candidate.row.id, { has_arrived: true })
    await patchCandidate(candidate.row.id, { assigned_room: roomId(debateRoom) })
    await patchCandidate(candidate.row.id, { has_arrived: false })

    const row = await fresh()
    t.equal('Rule 1: un-ticking Arrived clears the room', row.assigned_room, null)
    t.equal('Rule 1: and the task', row.current_task_assignment, null)
    t.equal('Rule 1: and the clock', row.room_entry_time, null)
    t.equal('Rule 1: and the arrival stamp', row.arrival_time, null)
    t.equal('Rule 1: and the debate result', row.debate_interview_completed, false)
    t.equal('Rule 1: and the personal result', row.personal_interview_completed, false)
  }

  /* --------------------------- Rule 7 — conflicts ------------------------- */
  {
    staffedRoom = await createRoom(`${PREFIX}STAFFED-${stamp}`, 'Debate', 'daniel')
    t.ok('Rule 7: (a Debate room staffed by daniel exists)', Boolean(staffedRoom.row))

    const restricted = await insertOne({
      name: `${PREFIX}CONF-${stamp}`,
      serial_number: `${PREFIX}C-${stamp}`,
      has_arrived: true,
      interviewer_constraints: ['  DANIEL  ', 'Dana'],
    })
    const id = restricted.row.id
    t.ok(
      'Rule 7: the constraint list is normalised on the way in',
      Array.isArray(restricted.row.interviewer_constraints),
      JSON.stringify(restricted.row.interviewer_constraints),
    )

    const blocked = await patchCandidate(id, { assigned_room: roomId(staffedRoom) })
    t.equal('Rule 7: a conflicting PATCH is refused', blocked.status, 400)
    t.ok(
      'Rule 7: and says exactly why',
      /Conflict of interest/.test(JSON.stringify(blocked.data)),
      JSON.stringify(blocked.data),
    )
    t.equal('Rule 7: nothing was assigned', (await readCandidate(id)).assigned_room, null)

    // The stored case is uppercase, the room's is lowercase — still a conflict.
    const blockedAgain = await patchCandidate(id, { assigned_room: roomId(staffedRoom) })
    t.equal('Rule 7: matching is case-insensitive in the database', blockedAgain.status, 400)

    const inserted = await insertOne({
      name: `${PREFIX}CONFINS-${stamp}`,
      serial_number: `${PREFIX}CI-${stamp}`,
      has_arrived: true,
      interviewer_constraints: ['daniel'],
      assigned_room: roomId(staffedRoom),
    })
    t.equal('Rule 7: the insert path is refused too', inserted.status, 400)
    if (inserted.row) await rest(`candidates?id=eq.${inserted.row.id}`, { method: 'DELETE' })

    // A room nobody is assigned to can never conflict.
    const clear = await patchCandidate(id, { assigned_room: roomId(debateRoom) })
    t.equal('Rule 7: a room with no interviewer is fine', clear.status, 204)

    // Somebody else entirely is fine.
    const other = await createRoom(`${PREFIX}OTHER-${stamp}`, 'Debate', 'Romi')
    const allowed = await patchCandidate(id, { assigned_room: roomId(other) })
    t.ok('Rule 7: a room staffed by somebody else is allowed', allowed.status < 300, `status ${allowed.status}`)
    await rest(`rooms?id=eq.${roomId(other)}`, { method: 'DELETE' })

    // A name that merely resembles a restricted one is not a match.
    const near = await createRoom(`${PREFIX}NEAR-${stamp}`, 'Debate', 'Dana')
    const blockedNear = await patchCandidate(id, { assigned_room: roomId(near) })
    t.equal('Rule 7: "Dana" is blocked because the candidate restricted Dana', blockedNear.status, 400)
    await rest(`rooms?id=eq.${roomId(near)}`, { method: 'DELETE' })

    const lookalike = await createRoom(`${PREFIX}LOOK-${stamp}`, 'Debate', 'Danny')
    const allowedLookalike = await patchCandidate(id, { assigned_room: roomId(lookalike) })
    t.ok('Rule 7: a lookalike name ("Danny" vs "daniel") is not a conflict', allowedLookalike.status < 300, `status ${allowedLookalike.status}`)
    await rest(`rooms?id=eq.${roomId(lookalike)}`, { method: 'DELETE' })

    // Releasing is never blocked, even once a conflict appears around them.
    await patchCandidate(id, { assigned_room: roomId(debateRoom) })
    await rest(`rooms?id=eq.${roomId(debateRoom)}`, {
      method: 'PATCH',
      body: { interviewers: [{ name: 'daniel', phone: '123123123' }] },
    })
    const released = await patchCandidate(id, { assigned_room: null })
    t.ok('Rule 7: releasing a room is never blocked', released.status < 300, `status ${released.status}`)
    await rest(`rooms?id=eq.${roomId(debateRoom)}`, { method: 'PATCH', body: { interviewers: [] } })

    // A General room counts as a match for either interview, and is filtered too.
    const generalStaffed = await createRoom(`${PREFIX}GENSTAFF-${stamp}`, 'General', 'daniel')
    const generalBlocked = await patchCandidate(id, { assigned_room: roomId(generalStaffed) })
    t.equal('Rule 7: a conflicting General room is refused as well', generalBlocked.status, 400)
    await rest(`rooms?id=eq.${roomId(generalStaffed)}`, { method: 'DELETE' })

    // --- Rule 7 over a panel: one bad name in a group disqualifies the room ---

    const panelRoom = await createRoom(`${PREFIX}PANEL-${stamp}`, 'Debate', [
      { name: 'Romi', phone: '050-1111111' },
      { name: 'daniel', phone: '050-2222222' },
      { name: 'Yael', phone: null },
    ])
    t.equal('Rule 7: the stored panel keeps every interviewer', panelRoom.row?.interviewers?.length, 3)

    const panelBlocked = await patchCandidate(id, { assigned_room: roomId(panelRoom) })
    t.equal('Rule 7: a partial panel conflict still refuses the room', panelBlocked.status, 400)
    t.ok(
      'Rule 7: the refusal names the conflicting interviewer from the panel',
      String(panelBlocked.data?.message ?? '').includes('daniel'),
      String(panelBlocked.data?.message ?? ''),
    )

    const clean = await createRoom(`${PREFIX}PANELOK-${stamp}`, 'Debate', [
      { name: 'Romi', phone: null },
      { name: 'Yael', phone: null },
    ])
    const cleanAllowed = await patchCandidate(id, { assigned_room: roomId(clean) })
    t.ok('Rule 7: a panel of strangers is allowed', cleanAllowed.status < 300, `status ${cleanAllowed.status}`)
    await rest(`candidates?id=eq.${id}`, { method: 'PATCH', body: { assigned_room: null } })

    // The panel is tidied on the way in: blanks and duplicates never survive.
    const messy = await createRoom(`${PREFIX}MESSY-${stamp}`, 'Debate', [
      { name: '  ', phone: '0' },
      { name: '  Romi ', phone: ' 050-1 ' },
      { name: 'romi', phone: null },
      { name: 'daniel', phone: null },
    ])
    t.equal('Rule 7: a messy panel holds only its real, de-duplicated names', messy.row?.interviewers?.length, 2)
    const romi = (messy.row?.interviewers ?? []).find((person) => /^romi$/i.test(String(person?.name)))
    t.equal('Rule 7: the first spelling of a duplicate name wins', romi?.name, 'Romi')
    t.equal('Rule 7: and that spelling keeps its phone', romi?.phone, '050-1')

    for (const room of [panelRoom, clean, messy]) {
      await rest(`rooms?id=eq.${roomId(room)}`, { method: 'DELETE' })
    }

    await rest(`candidates?id=eq.${id}`, { method: 'DELETE' })
  }
} catch (error) {
  failures += 1
  console.log(`\n❌ ${error?.stack || error}`)
} finally {
  await cleanupScratch()
  const strays = await rest(`candidates?name=like.${PREFIX}*&select=name`)
  const strayRooms = await rest(`rooms?room_name=like.${PREFIX}*&select=room_name`)
  t.equal('cleanup: no scratch candidates left behind', Array.isArray(strays.data) ? strays.data.length : -1, 0)
  t.equal('cleanup: no scratch rooms left behind', Array.isArray(strayRooms.data) ? strayRooms.data.length : -1, 0)
}

failures += t.report()
process.exit(failures === 0 ? 0 : 1)
