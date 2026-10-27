/**
 * The movement ledger, executed against the live database.
 *
 * The trigger is the only thing that writes `candidate_events`, and the shapes
 * it produces are what `/admin/analytics` counts. So the honest test is the one
 * below: drive a candidate through arrival, dispatch, a room move, a completion
 * and an un-arrival through the same REST endpoint the UI uses, then read the
 * ledger back and check the rows the dashboard will see.
 *
 * Every row is named ZZQA-… and removed in `finally`. The ledger has no foreign
 * key to `candidates` on purpose, so cleanup deletes its rows by name prefix
 * before deleting the candidates.
 *
 *   npm run test:db
 */
import {
  ANON_KEY,
  PREFIX,
  cleanupScratch,
  configured,
  createRoom,
  harness,
  insertOne,
  patchCandidate,
  readCandidate,
  rest,
} from './env.mjs'

if (!configured) {
  console.log('ℹ️  No Supabase credentials in .env — skipping the database tests.')
  process.exit(0)
}

const t = harness('Candidate ledger (live database)')
const stamp = Date.now()
const candName = `${PREFIX}LEDGER-${stamp}`

const roomId = (room) => room?.row?.id ?? null

const eventsFor = async (id) => {
  const response = await rest(`candidate_events?candidate_id=eq.${id}&select=*&order=id.asc`)
  return Array.isArray(response.data) ? response.data : []
}

const kinds = (rows) => rows.map((row) => row.event)

/** Remove the ledger rows this script created, then the scratch rows. */
async function wipe() {
  await rest(`candidate_events?candidate_name=like.${PREFIX}*`, { method: 'DELETE' })
  await cleanupScratch()
}

let candidate = null
let personalRoom = null
let debateRoom = null

try {
  await wipe()

  /* ------------------------------- fixtures ------------------------------- */
  personalRoom = await createRoom(`${PREFIX}LEDGER-PER-${stamp}`, 'Personal', [
    { name: 'דניאל', phone: null },
    { name: 'רומי', phone: null },
  ])
  debateRoom = await createRoom(`${PREFIX}LEDGER-DEB-${stamp}`, 'Debate', [
    { name: 'טל', phone: null },
  ])

  if (!personalRoom.row || !debateRoom.row) {
    console.log('❌ Could not create the scratch rooms:', personalRoom.data, debateRoom.data)
    process.exit(1)
  }

  candidate = await insertOne({ name: candName, serial_number: `${PREFIX}${stamp}`, has_arrived: false })
  if (!candidate.row) {
    console.log('❌ Could not create the scratch candidate:', candidate.data)
    process.exit(1)
  }

  const id = candidate.row.id
  t.equal('a new, unarrived candidate writes nothing', (await eventsFor(id)).length, 0)

  /* ------------------------------- arrival -------------------------------- */
  await patchCandidate(id, { has_arrived: true })
  {
    const rows = await eventsFor(id)
    t.equal('ticking Arrived writes one arrived event', kinds(rows).join(','), 'arrived')
    t.equal('the event snapshots the candidate name', rows[0]?.candidate_name, candName)
    t.equal('the event has no room', rows[0]?.room_id, null)
  }

  /* ------------------------------ dispatch -------------------------------- */
  await patchCandidate(id, { assigned_room: roomId(personalRoom) })
  {
    const rows = await eventsFor(id)
    const assigned = rows.at(-1)
    t.equal('putting somebody in a room appends assigned', assigned?.event, 'assigned')
    t.equal('the event snapshots the room name', assigned?.room_name, personalRoom.row.room_name)
    t.equal('the event records the task Rule 6 chose', assigned?.task, 'Personal Interview')
    t.equal('the event snapshots the room panel', assigned?.interviewer, 'דניאל, רומי')
    t.equal('nothing is released on a first assignment', rows.filter((row) => row.event === 'released').length, 0)
  }

  /* -------------------------------- a move -------------------------------- */
  await patchCandidate(id, { assigned_room: roomId(debateRoom) })
  {
    const rows = await eventsFor(id)
    const tail = rows.slice(-2)
    t.equal('a move releases the old room and assigns the new one', kinds(tail).join(','), 'released,assigned')
    t.equal('the released row names the room being left', tail[0]?.room_name, personalRoom.row.room_name)
    t.equal('the released row keeps the task that was running', tail[0]?.task, 'Personal Interview')
    t.equal('the assigned row names the new room', tail[1]?.room_name, debateRoom.row.room_name)
    t.equal('the assigned row carries the new task', tail[1]?.task, 'Debate Interview')
    t.ok(
      'the release is written before the assignment',
      Number(tail[0]?.id) < Number(tail[1]?.id),
      `${tail[0]?.id} vs ${tail[1]?.id}`,
    )
  }

  /* ------------------------------- completion ----------------------------- */
  await patchCandidate(id, { has_arrived: true, debate_interview_completed: true })
  {
    const rows = await eventsFor(id)
    const completed = rows.at(-1)
    t.equal('finishing an interview appends completed', completed?.event, 'completed')
    t.equal('the completion records the task', completed?.task, 'Debate Interview')
    t.equal('the completion records the room they were in', completed?.room_name, debateRoom.row.room_name)
    t.equal('the completion snapshots the panel', completed?.interviewer, 'טל')

    const row = await readCandidate(id)
    t.equal('Rule 3 still released the room', row?.assigned_room, null)
    t.equal(
      'a completion writes one completed row, not a release too',
      rows.filter((entry) => entry.event === 'completed').length,
      1,
    )
  }

  /* ------------------------------ un-arrival ------------------------------ */
  await patchCandidate(id, { has_arrived: false })
  {
    const rows = await eventsFor(id)
    const tail = kinds(rows).slice(-2)
    t.equal('un-ticking Arrived records the reversal', tail.join(','), 'completed,unarrived')
  }

  /* ------------------------------ append-only ----------------------------- */
  {
    const anonymous = await rest('candidate_events?select=id&limit=1', {
      key: ANON_KEY,
      bearer: ANON_KEY,
    })
    t.ok(
      'anonymous visitors cannot read the ledger',
      anonymous.status !== 200 || (Array.isArray(anonymous.data) && anonymous.data.length === 0),
      `status ${anonymous.status}`,
    )

    const deleted = await rest(`candidate_events?candidate_id=eq.${id}`, {
      method: 'DELETE',
      key: ANON_KEY,
      bearer: ANON_KEY,
    })
    t.ok('anonymous visitors cannot delete the ledger', deleted.status >= 400, `status ${deleted.status}`)
  }
} catch (error) {
  t.ok('the ledger test ran without throwing', false, error?.stack ?? String(error))
} finally {
  try {
    await wipe()
  } catch (error) {
    console.log('⚠️  Cleanup failed:', error?.message ?? error)
  }
}

process.exit(t.report())
