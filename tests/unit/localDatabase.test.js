import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalDatabase, resetLocalDatabase } from '../../src/services/localDatabase'

describe('localDatabase (Local Sandbox DB)', () => {
  beforeEach(() => {
    resetLocalDatabase()
  })

  it('seeds active and draft events with rooms, candidates, and evaluations', async () => {
    const db = createLocalDatabase()
    const summaries = await db.events.listSummaries()
    expect(summaries.length).toBeGreaterThanOrEqual(2)

    const active = summaries.find((s) => s.status === 'Active')
    expect(active).toBeDefined()
    expect(active.candidate_count).toBe(7)
    expect(active.room_count).toBe(5)

    const rooms = await db.rooms.list(active.id)
    expect(rooms).toHaveLength(5)

    const candidates = await db.candidates.list(active.id)
    expect(candidates).toHaveLength(7)
  })

  it('enforces conflict of interest and cross-event room isolation', async () => {
    const db = createLocalDatabase()
    const summaries = await db.events.listSummaries()
    const active = summaries.find((s) => s.status === 'Active')
    const draft = summaries.find((s) => s.status === 'Draft')

    const candidates = await db.candidates.list(active.id)
    const constrainedCandidate = candidates.find((c) => c.id === 'cand-2')
    const rooms = await db.rooms.list(active.id)
    const sl101 = rooms.find((r) => r.room_name === 'SL101')

    // Conflict of interest: cand-2 has Guy Mizrahi on restricted list, and SL101 has Guy Mizrahi
    await expect(
      db.candidates.update(constrainedCandidate.id, { assigned_room: sl101.id }),
    ).rejects.toThrow(/Conflict of interest/)

    // Cross-event room isolation
    const draftRooms = await db.rooms.list(draft.id)
    await expect(
      db.candidates.update(constrainedCandidate.id, { assigned_room: draftRooms[0].id }),
    ).rejects.toThrow(/does not belong to this event/)
  })

  it('logs movement ledger rows automatically on arrival, room assignment, release, and completion', async () => {
    const db = createLocalDatabase()
    const summaries = await db.events.listSummaries()
    const active = summaries.find((s) => s.status === 'Active')
    const candidates = await db.candidates.list(active.id)
    const notArrived = candidates.find((c) => !c.has_arrived && c.interviewer_constraints.length === 0)
    const rooms = await db.rooms.list(active.id)
    const openRoom = rooms.find((r) => r.room_name === 'CL05')

    const { events: beforeLedger } = await db.ledger.load(active.id)

    await db.candidates.update(notArrived.id, { has_arrived: true })
    await db.candidates.update(notArrived.id, { assigned_room: openRoom.id })
    await db.candidates.update(notArrived.id, { assigned_room: null })
    await db.candidates.update(notArrived.id, { assigned_room: openRoom.id })
    await db.candidates.update(notArrived.id, {
      personal_interview_completed: true,
    })

    const { events: afterLedger } = await db.ledger.load(active.id)
    const newMovements = afterLedger
      .slice(beforeLedger.length)
      .filter((row) => row.candidate_id === notArrived.id)
      .map((row) => row.event)

    expect(newMovements).toEqual(['arrived', 'assigned', 'released', 'assigned', 'completed'])
  })

  it('supports saving per-event custom forms and creating new events via the planner', async () => {
    const db = createLocalDatabase()
    const created = await db.events.create({
      name: 'Spring 2027 Screening',
      date: '2027-03-15',
      notes: 'Test event',
      forms: {
        PERSONAL_INTERVIEW: {
          title: 'Custom Personal Rubric',
          sections: [
            {
              id: 's1',
              title: 'Intro',
              questions: [{ key: 'q1', label: 'How was it?', type: 'short_text' }],
            },
          ],
        },
      },
    })

    const fetched = await db.events.findById(created.id)
    expect(fetched.forms.PERSONAL_INTERVIEW.title).toBe('Custom Personal Rubric')
  })
})
