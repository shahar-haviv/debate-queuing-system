/**
 * Pure domain rules and history-aware BP pairing / room-draw algorithms for
 * Club Training (`src/training/domain/pairingEngine.ts`).
 *
 * Replaces the legacy `debateidc` naive `pop()` assignment with an intelligent
 * solver that accounts for:
 *   1. Debater vs Judge preferences & Senior/Chair qualifications
 *   2. Mutual or one-way Partner requests
 *   3. Pairing strategies:
 *        • `balanced-history` — avoids repeat partners & opponents
 *        • `pro-am`           — pairs a Senior mentor with a first-year Junior
 *        • `skill-matched`    — power-pairs by average speaker points / rank
 *        • `random`           — randomized draw
 *   4. Minimum-cost BP position assignment (`OG`, `OO`, `CG`, `CO`) so every
 *      debater rotates evenly through their least-practiced positions
 *   5. Chair-to-Junior rotation so Juniors receive feedback from diverse Chairs
 */
import type {
  BpPosition,
  MemberHistoryStats,
  PairingOptions,
  RoomRole,
  TrainingDrawState,
  TrainingMember,
  TrainingRegistration,
  TrainingResult,
  TrainingRoomDraw,
} from '../types'

export const BP_POSITIONS: BpPosition[] = [
  'Opening Government',
  'Opening Opposition',
  'Closing Government',
  'Closing Opposition',
]

export const ALL_ROOM_ROLES: RoomRole[] = [...BP_POSITIONS, 'Chair', 'Panel']

export const DEFAULT_PAIRING_OPTIONS: PairingOptions = {
  strategy: 'balanced-history',
  honorPartnerRequests: true,
  balanceLeastPlayedPositions: true,
  rotateChairsAcrossJuniors: true,
  respectLanguagePreference: true,
  includeRegisteredNotCheckedIn: true,
}

const DEFAULT_ROOM_NAMES = ['A206', 'A207', 'CL05', 'SL101', 'PEB30', 'A320']

export function memberDisplayName(member: TrainingMember | undefined | null): string {
  if (!member) return 'Unknown'
  return member.full_name_heb?.trim() || member.full_name_eng?.trim() || member.email
}

/**
 * Compute historical statistics for every club member from past `TrainingResult` rows.
 */
export function computeAllMemberStats(
  members: TrainingMember[],
  results: TrainingResult[],
): Record<string, MemberHistoryStats> {
  const map: Record<string, MemberHistoryStats> = {}

  for (const m of members) {
    map[m.id] = {
      memberId: m.id,
      totalRounds: 0,
      debateRounds: 0,
      judgeRounds: 0,
      averageSpeaks: null,
      firstPlaceCount: 0,
      positions: {
        'Opening Government': 0,
        'Opening Opposition': 0,
        'Closing Government': 0,
        'Closing Opposition': 0,
        Chair: 0,
        Panel: 0,
      },
      leastPlayedPosition: 'Opening Government',
      partnerCounts: {},
      chairCounts: {},
    }
  }

  const speaksAccum: Record<string, number[]> = {}

  for (const row of results) {
    const stat = map[row.member_id]
    if (!stat) continue

    stat.totalRounds += 1
    stat.positions[row.position] = (stat.positions[row.position] ?? 0) + 1

    if (row.position === 'Chair' || row.position === 'Panel') {
      stat.judgeRounds += 1
    } else {
      stat.debateRounds += 1
      if (row.team_rank === 1) stat.firstPlaceCount += 1
      if (typeof row.speaker_points === 'number' && row.speaker_points > 0) {
        if (!speaksAccum[row.member_id]) speaksAccum[row.member_id] = []
        speaksAccum[row.member_id].push(row.speaker_points)
      }
      if (row.partner_id) {
        stat.partnerCounts[row.partner_id] = (stat.partnerCounts[row.partner_id] ?? 0) + 1
      }
      if (row.chair_id) {
        stat.chairCounts[row.chair_id] = (stat.chairCounts[row.chair_id] ?? 0) + 1
      }
    }
  }

  for (const m of members) {
    const stat = map[m.id]
    const speaks = speaksAccum[m.id]
    if (speaks && speaks.length > 0) {
      const sum = speaks.reduce((acc, v) => acc + v, 0)
      stat.averageSpeaks = Math.round((sum / speaks.length) * 10) / 10
    }

    let minPos: BpPosition = 'Opening Government'
    let minCount = Number.POSITIVE_INFINITY
    for (const pos of BP_POSITIONS) {
      const count = stat.positions[pos] ?? 0
      if (count < minCount) {
        minCount = count
        minPos = pos
      }
    }
    stat.leastPlayedPosition = minPos
  }

  return map
}

/**
 * Build the Chair × Junior exposure matrix (how many times each Senior/Chair has
 * judged each Junior debater), replacing the manual Excel export in legacy Debate DMS.
 */
export function computeChairJuniorMatrix(
  members: TrainingMember[],
  results: TrainingResult[],
): {
  chairs: TrainingMember[]
  juniors: TrainingMember[]
  counts: Record<string, Record<string, number>>
} {
  const stats = computeAllMemberStats(members, results)
  const chairs = members.filter(
    (m) =>
      m.rank === 'Senior' ||
      m.official_judgement_level === 'Chair' ||
      m.official_judgement_level === 'CA' ||
      (stats[m.id]?.positions.Chair ?? 0) > 0,
  )
  const juniors = members.filter((m) => m.rank === 'Junior')

  const counts: Record<string, Record<string, number>> = {}
  for (const jr of juniors) {
    counts[jr.id] = {}
    for (const ch of chairs) {
      counts[jr.id][ch.id] = stats[jr.id]?.chairCounts[ch.id] ?? 0
    }
  }

  return { chairs, juniors, counts }
}

/** All 24 permutations of the 4 BP positions for minimum-cost position assignment. */
const POSITION_PERMUTATIONS: BpPosition[][] = [
  ['Opening Government', 'Opening Opposition', 'Closing Government', 'Closing Opposition'],
  ['Opening Government', 'Opening Opposition', 'Closing Opposition', 'Closing Government'],
  ['Opening Government', 'Closing Government', 'Opening Opposition', 'Closing Opposition'],
  ['Opening Government', 'Closing Government', 'Closing Opposition', 'Opening Opposition'],
  ['Opening Government', 'Closing Opposition', 'Opening Opposition', 'Closing Government'],
  ['Opening Government', 'Closing Opposition', 'Closing Government', 'Opening Opposition'],
  ['Opening Opposition', 'Opening Government', 'Closing Government', 'Closing Opposition'],
  ['Opening Opposition', 'Opening Government', 'Closing Opposition', 'Closing Government'],
  ['Opening Opposition', 'Closing Government', 'Opening Government', 'Closing Opposition'],
  ['Opening Opposition', 'Closing Government', 'Closing Opposition', 'Opening Government'],
  ['Opening Opposition', 'Closing Opposition', 'Opening Government', 'Closing Government'],
  ['Opening Opposition', 'Closing Opposition', 'Closing Government', 'Opening Government'],
  ['Closing Government', 'Opening Government', 'Opening Opposition', 'Closing Opposition'],
  ['Closing Government', 'Opening Government', 'Closing Opposition', 'Opening Opposition'],
  ['Closing Government', 'Opening Opposition', 'Opening Government', 'Closing Opposition'],
  ['Closing Government', 'Opening Opposition', 'Closing Opposition', 'Opening Government'],
  ['Closing Government', 'Closing Opposition', 'Opening Government', 'Opening Opposition'],
  ['Closing Government', 'Closing Opposition', 'Opening Opposition', 'Opening Government'],
  ['Closing Opposition', 'Opening Government', 'Opening Opposition', 'Closing Government'],
  ['Closing Opposition', 'Opening Government', 'Closing Government', 'Opening Opposition'],
  ['Closing Opposition', 'Opening Opposition', 'Opening Government', 'Closing Government'],
  ['Closing Opposition', 'Opening Opposition', 'Closing Government', 'Opening Government'],
  ['Closing Opposition', 'Closing Government', 'Opening Government', 'Opening Opposition'],
  ['Closing Opposition', 'Closing Government', 'Opening Opposition', 'Opening Government'],
]

interface TeamPair {
  members: [TrainingMember, TrainingMember]
  language: 'Hebrew' | 'English' | 'No preference'
  reason: string
}

/**
 * Smart Auto-Fill Room & Pairing Engine.
 *
 * Allocates active registrations into full 8-debater (4-team) BP rooms + Chairs
 * + Panelists, putting any remainder < 8 into either a partial practice room
 * or Panel/Waitlist cleanly.
 */
export function generateSmartRoomDraw(
  members: TrainingMember[],
  registrations: TrainingRegistration[],
  results: TrainingResult[],
  options: PairingOptions = DEFAULT_PAIRING_OPTIONS,
  existingRoomNames: string[] = [],
): TrainingDrawState {
  const memberById = new Map(members.map((m) => [m.id, m]))
  const stats = computeAllMemberStats(members, results)

  const eligibleRegs = registrations.filter((reg) => {
    if (reg.status === 'Cancelled') return false
    if (reg.status === 'CheckedIn') return true
    return options.includeRegisteredNotCheckedIn && reg.status === 'Registered'
  })

  // Deduplicate by member_id
  const activeRegs: TrainingRegistration[] = []
  const seenMembers = new Set<string>()
  for (const reg of eligibleRegs) {
    if (!seenMembers.has(reg.member_id) && memberById.has(reg.member_id)) {
      seenMembers.add(reg.member_id)
      activeRegs.push(reg)
    }
  }

  if (activeRegs.length === 0) {
    return {
      rooms: [],
      waitlist: [],
      trash: [],
      strategy: options.strategy,
      generated_at: new Date().toISOString(),
    }
  }

  const regByMemberId = new Map(activeRegs.map((r) => [r.member_id, r]))

  // Determine how many full 8-debater rooms we can form (each needs at least 1 Chair + 8 debaters = 9 people,
  // or if total participants >= 8 we can run 1 room with 8 debaters + any judges).
  const explicitJudges = activeRegs.filter((r) => r.role_preference === 'Judge')
  const explicitDebaters = activeRegs.filter((r) => r.role_preference === 'Debate')
  const flexRegs = activeRegs.filter((r) => r.role_preference === 'No preference')

  const totalPeople = activeRegs.length
  const fullRoomsCount = Math.max(1, Math.floor(totalPeople / 9))
  const targetDebaterPairs = Math.min(
    fullRoomsCount * 4,
    Math.floor((explicitDebaters.length + flexRegs.length) / 2),
  )

  // 1. Separate Judges vs Debaters
  const judgePool: TrainingMember[] = explicitJudges
    .map((r) => memberById.get(r.member_id)!)
    .filter(Boolean)

  const debaterCandidates: TrainingMember[] = [
    ...explicitDebaters.map((r) => memberById.get(r.member_id)!),
    ...flexRegs
      .map((r) => memberById.get(r.member_id)!)
      .sort((a, b) => {
        // Prefer keeping Juniors as debaters and Seniors/Chairs available if judges are needed
        if (a.rank !== b.rank) return a.rank === 'Junior' ? -1 : 1
        return (stats[a.id]?.debateRounds ?? 0) - (stats[b.id]?.debateRounds ?? 0)
      }),
  ].filter(Boolean)

  // Ensure each room has at least 1 Chair if possible
  const roomsNeeded = Math.max(1, Math.ceil(targetDebaterPairs / 4))
  while (judgePool.length < roomsNeeded && debaterCandidates.length > 2) {
    // Pull the most experienced Senior/Chair from the tail of debaterCandidates
    let seniorIdx = -1
    for (let i = debaterCandidates.length - 1; i >= 0; i--) {
      const m = debaterCandidates[i]
      if (m.rank === 'Senior' || m.official_judgement_level !== 'Wing') {
        seniorIdx = i
        break
      }
    }
    const idxToPull = seniorIdx >= 0 ? seniorIdx : debaterCandidates.length - 1
    const [pulled] = debaterCandidates.splice(idxToPull, 1)
    if (pulled) judgePool.push(pulled)
  }

  // If debaterCandidates has an odd number, move the last flex/senior to Panel (judgePool)
  if (debaterCandidates.length % 2 === 1) {
    const extra = debaterCandidates.pop()
    if (extra) judgePool.push(extra)
  }

  // If we have more debater pairs than 4 * roomsNeeded, cap to 4 teams per room and put surplus on Panel/Waitlist
  const maxDebaters = roomsNeeded * 8
  const waitlist: string[] = []
  while (debaterCandidates.length > maxDebaters) {
    const overflow = debaterCandidates.pop()
    if (overflow) {
      const reg = regByMemberId.get(overflow.id)
      if (reg?.role_preference === 'No preference' || overflow.rank === 'Senior') {
        judgePool.push(overflow)
      } else {
        waitlist.push(overflow.id)
      }
    }
  }

  // 2. Pair Debaters into 2-person Teams
  const unassignedDebaters = [...debaterCandidates]
  const teams: TeamPair[] = []
  const pairedIds = new Set<string>()

  const getLanguage = (a: TrainingMember, b: TrainingMember): 'Hebrew' | 'English' | 'No preference' => {
    const la = regByMemberId.get(a.id)?.language_preference ?? 'No preference'
    const lb = regByMemberId.get(b.id)?.language_preference ?? 'No preference'
    if (la === 'English' || lb === 'English') return 'English'
    if (la === 'Hebrew' || lb === 'Hebrew') return 'Hebrew'
    return 'No preference'
  }

  // Step 2a: Honor partner requests first
  if (options.honorPartnerRequests) {
    for (const d of unassignedDebaters) {
      if (pairedIds.has(d.id)) continue
      const reg = regByMemberId.get(d.id)
      const requestedId = reg?.partner_id
      if (!requestedId || pairedIds.has(requestedId)) continue
      const partner = unassignedDebaters.find((cand) => cand.id === requestedId)
      if (partner && partner.id !== d.id) {
        pairedIds.add(d.id)
        pairedIds.add(partner.id)
        teams.push({
          members: [d, partner],
          language: getLanguage(d, partner),
          reason: `Requested partner (${memberDisplayName(d)} + ${memberDisplayName(partner)})`,
        })
      }
    }
  }

  const remaining = unassignedDebaters.filter((d) => !pairedIds.has(d.id))

  // Step 2b: Pair remaining debaters according to strategy
  if (options.strategy === 'pro-am') {
    const seniors = remaining.filter((d) => d.rank === 'Senior')
    const juniors = remaining.filter((d) => d.rank === 'Junior')

    while (seniors.length > 0 && juniors.length > 0) {
      const sr = seniors.shift()!
      // Pick the junior who has partnered with `sr` the least
      juniors.sort(
        (j1, j2) =>
          (stats[sr.id]?.partnerCounts[j1.id] ?? 0) - (stats[sr.id]?.partnerCounts[j2.id] ?? 0),
      )
      const jr = juniors.shift()!
      teams.push({
        members: [sr, jr],
        language: getLanguage(sr, jr),
        reason: `Pro-Am pair (Senior ${memberDisplayName(sr)} + Junior ${memberDisplayName(jr)})`,
      })
    }

    const leftovers = [...seniors, ...juniors]
    while (leftovers.length >= 2) {
      const a = leftovers.shift()!
      const b = leftovers.shift()!
      teams.push({
        members: [a, b],
        language: getLanguage(a, b),
        reason: `Balanced pair (${a.rank} + ${b.rank})`,
      })
    }
  } else if (options.strategy === 'skill-matched') {
    const sorted = [...remaining].sort((a, b) => {
      const sa = stats[a.id]?.averageSpeaks ?? (a.rank === 'Senior' ? 77 : 74)
      const sb = stats[b.id]?.averageSpeaks ?? (b.rank === 'Senior' ? 77 : 74)
      return sb - sa
    })
    while (sorted.length >= 2) {
      const a = sorted.shift()!
      const b = sorted.shift()!
      const sa = stats[a.id]?.averageSpeaks ?? '—'
      const sb = stats[b.id]?.averageSpeaks ?? '—'
      teams.push({
        members: [a, b],
        language: getLanguage(a, b),
        reason: `Skill-matched pair (Avg speaks: ${sa} & ${sb})`,
      })
    }
  } else if (options.strategy === 'random') {
    const pool = [...remaining]
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    while (pool.length >= 2) {
      const a = pool.shift()!
      const b = pool.shift()!
      teams.push({
        members: [a, b],
        language: getLanguage(a, b),
        reason: 'Randomized draw pair',
      })
    }
  } else {
    // Default: 'balanced-history' — minimize repeat partnerships and respect language preference
    const pool = [...remaining]
    while (pool.length >= 2) {
      const a = pool.shift()!
      const langA = regByMemberId.get(a.id)?.language_preference ?? 'No preference'

      pool.sort((b1, b2) => {
        const past1 = stats[a.id]?.partnerCounts[b1.id] ?? 0
        const past2 = stats[a.id]?.partnerCounts[b2.id] ?? 0
        if (past1 !== past2) return past1 - past2

        if (options.respectLanguagePreference && langA !== 'No preference') {
          const l1 = regByMemberId.get(b1.id)?.language_preference === langA ? 0 : 1
          const l2 = regByMemberId.get(b2.id)?.language_preference === langA ? 0 : 1
          if (l1 !== l2) return l1 - l2
        }

        // Prefer pairing Junior with Senior if available
        const mix1 = a.rank !== b1.rank ? 0 : 1
        const mix2 = a.rank !== b2.rank ? 0 : 1
        return mix1 - mix2
      })

      const b = pool.shift()!
      const pastCount = stats[a.id]?.partnerCounts[b.id] ?? 0
      teams.push({
        members: [a, b],
        language: getLanguage(a, b),
        reason:
          pastCount === 0
            ? `First-time partnership (${memberDisplayName(a)} & ${memberDisplayName(b)})`
            : `History-balanced pair (${pastCount} prior round together)`,
      })
    }
  }

  // 3. Group Teams into Rooms of up to 4 Teams
  if (options.respectLanguagePreference) {
    teams.sort((t1, t2) => {
      const order = { Hebrew: 0, 'No preference': 1, English: 2 }
      return order[t1.language] - order[t2.language]
    })
  }

  const numRooms = Math.max(1, Math.ceil(teams.length / 4))
  const rooms: TrainingRoomDraw[] = []

  for (let rIdx = 0; rIdx < numRooms; rIdx++) {
    const roomTeams = teams.slice(rIdx * 4, rIdx * 4 + 4)
    const roomName =
      existingRoomNames[rIdx] || DEFAULT_ROOM_NAMES[rIdx] || `Room ${rIdx + 1}`

    const roomLang: 'Hebrew' | 'English' =
      roomTeams.some((t) => t.language === 'English') &&
      roomTeams.every((t) => t.language !== 'Hebrew')
        ? 'English'
        : 'Hebrew'

    const explanations: string[] = []

    // 4. Optimal BP Position Assignment (OG, OO, CG, CO) using minimum-cost permutation
    let chosenPositions: BpPosition[] = [...BP_POSITIONS]

    if (options.balanceLeastPlayedPositions && roomTeams.length > 0) {
      let bestCost = Number.POSITIVE_INFINITY
      for (const perm of POSITION_PERMUTATIONS) {
        let cost = 0
        for (let i = 0; i < roomTeams.length; i++) {
          const pos = perm[i]
          const [m1, m2] = roomTeams[i].members
          cost += (stats[m1.id]?.positions[pos] ?? 0) + (stats[m2.id]?.positions[pos] ?? 0)
        }
        if (cost < bestCost) {
          bestCost = cost
          chosenPositions = perm
        }
      }
    }

    const roomDraw: TrainingRoomDraw = {
      id: `draw-room-${rIdx + 1}`,
      room_name: roomName,
      language: roomLang,
      'Opening Government': [],
      'Opening Opposition': [],
      'Closing Government': [],
      'Closing Opposition': [],
      Chair: [],
      Panel: [],
      explanations,
    }

    for (let i = 0; i < roomTeams.length; i++) {
      const pos = chosenPositions[i]
      const team = roomTeams[i]
      const [m1, m2] = team.members
      roomDraw[pos] = [m1.id, m2.id]
      const c1 = stats[m1.id]?.positions[pos] ?? 0
      const c2 = stats[m2.id]?.positions[pos] ?? 0
      explanations.push(
        `${pos}: ${team.reason} — prior ${pos} count: ${c1}x & ${c2}x`,
      )
    }

    rooms.push(roomDraw)
  }

  // 5. Allocate Chairs & Panelists across Rooms (rotating Chairs across Juniors)
  const sortedJudges = [...judgePool].sort((a, b) => {
    const levelOrder = { CA: 0, Chair: 1, Wing: 2 }
    const la = levelOrder[a.official_judgement_level] ?? 2
    const lb = levelOrder[b.official_judgement_level] ?? 2
    if (la !== lb) return la - lb
    if (a.rank !== b.rank) return a.rank === 'Senior' ? -1 : 1
    return (stats[b.id]?.judgeRounds ?? 0) - (stats[a.id]?.judgeRounds ?? 0)
  })

  const remainingJudges = [...sortedJudges]

  for (const room of rooms) {
    if (remainingJudges.length === 0) break

    const roomDebaterIds = [
      ...room['Opening Government'],
      ...room['Opening Opposition'],
      ...room['Closing Government'],
      ...room['Closing Opposition'],
    ]
    const roomJuniors = roomDebaterIds
      .map((id) => memberById.get(id))
      .filter((m): m is TrainingMember => Boolean(m && m.rank === 'Junior'))

    if (options.rotateChairsAcrossJuniors && roomJuniors.length > 0) {
      remainingJudges.sort((j1, j2) => {
        const levelOrder = { CA: 0, Chair: 1, Wing: 2 }
        const q1 = j1.rank === 'Senior' || levelOrder[j1.official_judgement_level] <= 1 ? 0 : 1
        const q2 = j2.rank === 'Senior' || levelOrder[j2.official_judgement_level] <= 1 ? 0 : 1
        if (q1 !== q2) return q1 - q2

        const exp1 = roomJuniors.reduce(
          (sum, jr) => sum + (stats[jr.id]?.chairCounts[j1.id] ?? 0),
          0,
        )
        const exp2 = roomJuniors.reduce(
          (sum, jr) => sum + (stats[jr.id]?.chairCounts[j2.id] ?? 0),
          0,
        )
        return exp1 - exp2
      })
    }

    const chair = remainingJudges.shift()!
    room.Chair = [chair.id]
    const priorJudged = roomJuniors.reduce(
      (sum, jr) => sum + (stats[jr.id]?.chairCounts[chair.id] ?? 0),
      0,
    )
    room.explanations?.unshift(
      `Chair ${memberDisplayName(chair)} (${chair.official_judgement_level}) — ${priorJudged} prior rounds judging Juniors in this room`,
    )
  }

  // Distribute remaining judges onto room Panels evenly
  let roomCursor = 0
  while (remainingJudges.length > 0 && rooms.length > 0) {
    const panelist = remainingJudges.shift()!
    rooms[roomCursor % rooms.length].Panel.push(panelist.id)
    roomCursor++
  }

  return {
    rooms,
    waitlist,
    trash: [],
    strategy: options.strategy,
    generated_at: new Date().toISOString(),
  }
}

/**
 * Format the room draw as the standard Assignments CSV (matching `debateidc` format).
 */
export function exportAssignmentsCsv(
  rooms: TrainingRoomDraw[],
  memberById: Map<string, TrainingMember>,
): string {
  const header = [
    'Room Name',
    'Room Language',
    'Opening Government',
    'Opening Opposition',
    'Closing Government',
    'Closing Opposition',
    'Chair',
    'Panel',
  ]
  const rows: string[][] = [header]

  for (const room of rooms) {
    const maxRows = Math.max(
      1,
      room['Opening Government'].length,
      room['Opening Opposition'].length,
      room['Closing Government'].length,
      room['Closing Opposition'].length,
      room.Chair.length,
      room.Panel.length,
    )
    for (let i = 0; i < maxRows; i++) {
      const nameOf = (id: string | undefined) =>
        id ? memberDisplayName(memberById.get(id)) : ''
      rows.push([
        i === 0 ? room.room_name : '',
        i === 0 ? room.language : '',
        nameOf(room['Opening Government'][i]),
        nameOf(room['Opening Opposition'][i]),
        nameOf(room['Closing Government'][i]),
        nameOf(room['Closing Opposition'][i]),
        nameOf(room.Chair[i]),
        nameOf(room.Panel[i]),
      ])
    }
  }

  return rows
    .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
}

/**
 * Format the room draw as a Zoom Breakout Rooms pre-assignment CSV
 * (`Pre-assign Room Name,Email Address`).
 */
export function exportZoomBreakoutCsv(
  rooms: TrainingRoomDraw[],
  memberById: Map<string, TrainingMember>,
): string {
  const rows: string[][] = [['Pre-assign Room Name', 'Email Address']]

  rooms.forEach((room, idx) => {
    const zoomRoomName = room.room_name || `room${idx + 1}`
    const allIds = [
      ...room.Chair,
      ...room.Panel,
      ...room['Opening Government'],
      ...room['Opening Opposition'],
      ...room['Closing Government'],
      ...room['Closing Opposition'],
    ]
    for (const id of allIds) {
      const email = memberById.get(id)?.email
      if (email) {
        rows.push([zoomRoomName, email])
      }
    }
  })

  return rows
    .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
}
