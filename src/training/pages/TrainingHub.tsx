import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import AppHeader from '../../components/ui/AppHeader'
import {
  ALL_ROOM_ROLES,
  BP_POSITIONS,
  DEFAULT_PAIRING_OPTIONS,
  exportAssignmentsCsv,
  memberDisplayName,
} from '../domain/pairingEngine'
import { useTraining } from '../hooks/useTraining'
import type {
  BpPosition,
  PairingOptions,
  PairingStrategy,
  RoomRole,
  TrainingMember,
  TrainingRoomDraw,
} from '../types'

type TrainingTab = 'draw' | 'results' | 'roster'

function downloadCsvFile(filename: string, csvContent: string): void {
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export default function TrainingHub() {
  const {
    members,
    sessions,
    registrations,
    memberById,
    memberStats,
    chairJuniorMatrix,
    actions,
  } = useTraining()

  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<TrainingTab>(() => {
    const q = searchParams.get('tab') as TrainingTab | null
    if (q && ['draw', 'results', 'roster'].includes(q)) return q
    return 'draw'
  })

  const [selectedSessionId, setSelectedSessionId] = useState<string>(
    () => searchParams.get('session') ?? sessions[0]?.id ?? '',
  )

  useEffect(() => {
    const qTab = searchParams.get('tab') as TrainingTab | null
    if (qTab && ['draw', 'results', 'roster'].includes(qTab)) {
      setActiveTab(qTab)
    }
    const qSession = searchParams.get('session')
    if (qSession) {
      setSelectedSessionId(qSession)
    }
  }, [searchParams])

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? sessions[0] ?? null,
    [sessions, selectedSessionId],
  )

  const [pairingOptions, setPairingOptions] = useState<PairingOptions>(DEFAULT_PAIRING_OPTIONS)

  // Compact Ballot Form State
  const [resMemberId, setResMemberId] = useState<string>(() => members[5]?.id ?? '')
  const [resPartnerId, setResPartnerId] = useState<string>(() => members[6]?.id ?? '')
  const [resChairId, setResChairId] = useState<string>(() => members[1]?.id ?? '')
  const [resPosition, setResPosition] = useState<RoomRole>('Closing Government')
  const [resRank, setResRank] = useState<1 | 2 | 3 | 4>(1)
  const [resSpeaks, setResSpeaks] = useState<number>(77)
  const [resFeedback, setResFeedback] = useState<string>('')

  // Roster Search
  const [rosterSearch, setRosterSearch] = useState('')

  const sessionRegistrations = useMemo(
    () =>
      activeSession
        ? registrations.filter(
            (r) => r.session_id === activeSession.id && r.status !== 'Cancelled',
          )
        : [],
    [activeSession, registrations],
  )

  const pendingMembers = useMemo(
    () => members.filter((m) => m.permissions === 'Pending'),
    [members],
  )

  const handleRunSmartDraw = () => {
    if (!activeSession) return
    actions.runSmartAutoFill(activeSession.id, pairingOptions)
  }

  const handleMoveMemberInDraw = (
    memberId: string,
    targetRoomId: string | 'waitlist',
    targetRole?: RoomRole,
  ) => {
    if (!activeSession) return
    const nextDraw = structuredClone(activeSession.draw)

    for (const r of nextDraw.rooms) {
      for (const role of ALL_ROOM_ROLES) {
        r[role] = r[role].filter((id) => id !== memberId)
      }
    }
    nextDraw.waitlist = nextDraw.waitlist.filter((id) => id !== memberId)

    if (targetRoomId === 'waitlist') {
      nextDraw.waitlist.push(memberId)
    } else if (targetRole) {
      const room = nextDraw.rooms.find((r) => r.id === targetRoomId)
      if (room) {
        room[targetRole].push(memberId)
      }
    }

    actions.updateSession(activeSession.id, { draw: nextDraw })
  }

  const handleAddRoomToDraw = () => {
    if (!activeSession) return
    const nextDraw = structuredClone(activeSession.draw)
    const idx = nextDraw.rooms.length + 1
    const newRoom: TrainingRoomDraw = {
      id: `draw-room-${Date.now()}`,
      room_name: `Room ${idx}`,
      language: 'Hebrew',
      'Opening Government': [],
      'Opening Opposition': [],
      'Closing Government': [],
      'Closing Opposition': [],
      Chair: [],
      Panel: [],
      explanations: [],
    }
    nextDraw.rooms.push(newRoom)
    actions.updateSession(activeSession.id, { draw: nextDraw })
  }

  const assignedMemberIdsInDraw = useMemo(() => {
    const set = new Set<string>()
    if (!activeSession) return set
    for (const r of activeSession.draw.rooms) {
      for (const role of ALL_ROOM_ROLES) {
        for (const id of r[role]) set.add(id)
      }
    }
    return set
  }, [activeSession])

  const unassignedRegisteredMembers = useMemo(() => {
    return sessionRegistrations
      .filter((reg) => !assignedMemberIdsInDraw.has(reg.member_id))
      .map((reg) => ({
        reg,
        member: memberById.get(reg.member_id),
      }))
      .filter((item): item is { reg: typeof item.reg; member: TrainingMember } =>
        Boolean(item.member),
      )
  }, [sessionRegistrations, assignedMemberIdsInDraw, memberById])

  const handleRecordResult = (e: FormEvent) => {
    e.preventDefault()
    if (!resMemberId) return
    actions.recordResult({
      session_id: activeSession?.id ?? null,
      session_date: activeSession?.date ?? new Date().toISOString().slice(0, 10),
      room_name: activeSession?.draw.rooms[0]?.room_name ?? 'A206',
      member_id: resMemberId,
      partner_id:
        resPosition === 'Chair' || resPosition === 'Panel' ? null : resPartnerId || null,
      chair_id: resPosition === 'Chair' ? null : resChairId || null,
      position: resPosition,
      team_rank: resPosition === 'Chair' || resPosition === 'Panel' ? null : resRank,
      speaker_points: resPosition === 'Chair' || resPosition === 'Panel' ? null : resSpeaks,
      positive_feedback: resFeedback.trim(),
      improvement_feedback: '',
    })
    setResFeedback('')
  }

  const filteredRoster = useMemo(() => {
    const q = rosterSearch.trim().toLowerCase()
    if (!q) return members
    return members.filter(
      (m) =>
        m.full_name_heb.toLowerCase().includes(q) ||
        m.full_name_eng.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q),
    )
  }, [members, rosterSearch])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        {/* Compact Header & Sub-Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-extrabold tracking-tight text-primary">
              Club Training
            </h1>
            <select
              aria-label="Select training session"
              value={activeSession?.id ?? ''}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="h-9 rounded-xl border border-input bg-white px-3 text-xs font-semibold text-foreground outline-none focus:border-primary"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.date} ({s.time}) — {s.title}
                </option>
              ))}
            </select>
          </div>

          <div role="tablist" className="flex gap-1 rounded-full border border-border bg-white p-1">
            {(
              [
                ['draw', 'Room Draw'],
                ['results', 'Positions & Matrix'],
                ['roster', `Club Roster (${members.length})`],
              ] as const
            ).map(([tabKey, label]) => (
              <button
                key={tabKey}
                type="button"
                role="tab"
                aria-selected={activeTab === tabKey}
                onClick={() => setActiveTab(tabKey)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
                  activeTab === tabKey
                    ? 'bg-secondary text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
                {tabKey === 'roster' && pendingMembers.length > 0 && (
                  <span className="ms-1.5 rounded-full bg-status-arrived px-1.5 py-0.2 text-[10px] font-bold text-white">
                    {pendingMembers.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* TAB 1: ROOM DRAW */}
        {activeTab === 'draw' && activeSession && (
          <div className="space-y-5">
            {/* Lean Draw Toolbar */}
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-white p-4 shadow-2xs">
              <div className="flex flex-wrap items-center gap-3">
                <select
                  aria-label="Pairing strategy"
                  value={pairingOptions.strategy}
                  onChange={(e) =>
                    setPairingOptions((prev) => ({
                      ...prev,
                      strategy: e.target.value as PairingStrategy,
                    }))
                  }
                  className="h-9 rounded-xl border border-input bg-muted/30 px-3 text-xs font-semibold text-foreground"
                >
                  <option value="balanced-history">Balanced History (Avoid Repeat Pairs)</option>
                  <option value="pro-am">Pro-Am (Senior + Junior)</option>
                  <option value="skill-matched">Skill-Matched (By Speaks)</option>
                  <option value="random">Random Draw</option>
                </select>

                <label className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={pairingOptions.balanceLeastPlayedPositions}
                    onChange={(e) =>
                      setPairingOptions((prev) => ({
                        ...prev,
                        balanceLeastPlayedPositions: e.target.checked,
                      }))
                    }
                  />
                  Balance Positions
                </label>

                <label className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={pairingOptions.rotateChairsAcrossJuniors}
                    onChange={(e) =>
                      setPairingOptions((prev) => ({
                        ...prev,
                        rotateChairsAcrossJuniors: e.target.checked,
                      }))
                    }
                  />
                  Rotate Chairs
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleRunSmartDraw}
                  className="h-9 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground shadow-2xs transition hover:opacity-95"
                >
                  Auto-Fill Rooms
                </button>
                <button
                  type="button"
                  onClick={handleAddRoomToDraw}
                  className="h-9 rounded-xl border border-border bg-white px-3 text-xs font-semibold text-foreground hover:bg-muted"
                >
                  + Add Room
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadCsvFile(
                      `IDC-Draw-${activeSession.date}.csv`,
                      exportAssignmentsCsv(activeSession.draw.rooms, memberById),
                    )
                  }
                  className="h-9 rounded-xl border border-border bg-white px-3 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Export CSV
                </button>
              </div>
            </section>

            {/* Unassigned Enrolled Members */}
            {unassignedRegisteredMembers.length > 0 && (
              <section className="rounded-2xl border border-border bg-white p-4 shadow-2xs">
                <p className="text-xs font-bold text-muted-foreground">
                  Unassigned Enrolled Members ({unassignedRegisteredMembers.length})
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {unassignedRegisteredMembers.map(({ reg, member }) => (
                    <div
                      key={member.id}
                      className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-1.5 text-xs"
                    >
                      <span className="font-bold text-foreground">
                        {memberDisplayName(member)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        ({member.rank} · {reg.role_preference})
                      </span>
                      {activeSession.draw.rooms.length > 0 && (
                        <select
                          aria-label={`Assign ${memberDisplayName(member)} to room`}
                          defaultValue=""
                          onChange={(e) => {
                            const [roomId, role] = e.target.value.split('::')
                            if (roomId && role) {
                              handleMoveMemberInDraw(member.id, roomId, role as RoomRole)
                            }
                          }}
                          className="rounded-lg border border-input bg-white px-2 py-0.5 text-[11px]"
                        >
                          <option value="">Assign to…</option>
                          {activeSession.draw.rooms.map((room) =>
                            ALL_ROOM_ROLES.map((role) => (
                              <option key={`${room.id}::${role}`} value={`${room.id}::${role}`}>
                                {room.room_name} → {role}
                              </option>
                            )),
                          )}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* BP Room Cards */}
            <div className="grid gap-5 lg:grid-cols-2">
              {activeSession.draw.rooms.map((room) => (
                <div
                  key={room.id}
                  className="overflow-hidden rounded-2xl border border-border bg-white shadow-2xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/35 px-4 py-3">
                    <span className="text-sm font-extrabold text-primary">
                      Room {room.room_name}
                    </span>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-lg bg-secondary/70 px-2.5 py-1 font-semibold text-primary">
                        Chair:{' '}
                        {room.Chair.map((id) => memberDisplayName(memberById.get(id))).join(', ') ||
                          'TBD'}
                      </span>
                      {room.Panel.length > 0 && (
                        <span className="rounded-lg bg-accent/70 px-2.5 py-1 font-semibold text-accent-foreground">
                          Panel:{' '}
                          {room.Panel.map((id) => memberDisplayName(memberById.get(id))).join(', ')}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
                    {BP_POSITIONS.map((pos: BpPosition) => {
                      const memberIds = room[pos]
                      return (
                        <div
                          key={pos}
                          className="rounded-xl border border-border bg-muted/20 p-3"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                              {pos}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {memberIds.length}/2
                            </span>
                          </div>

                          <ul className="mt-2 space-y-1.5">
                            {memberIds.map((memberId) => {
                              const m = memberById.get(memberId)
                              return (
                                <li
                                  key={memberId}
                                  className="flex items-center justify-between gap-1 rounded-lg border border-border/80 bg-white px-2.5 py-1.5 text-xs"
                                >
                                  <span className="font-semibold text-foreground">
                                    {memberDisplayName(m)}{' '}
                                    <span className="text-[10px] font-normal text-muted-foreground">
                                      ({m?.rank})
                                    </span>
                                  </span>
                                  <button
                                    type="button"
                                    title="Remove from bench"
                                    onClick={() => handleMoveMemberInDraw(memberId, 'waitlist')}
                                    className="text-muted-foreground hover:text-destructive"
                                  >
                                    ×
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: POSITIONS & MATRIX */}
        {activeTab === 'results' && (
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Compact Record Result Form */}
            <form
              onSubmit={handleRecordResult}
              className="space-y-3 rounded-2xl border border-border bg-white p-5 shadow-2xs lg:col-span-4"
            >
              <h2 className="text-sm font-extrabold text-primary">Record Round Result</h2>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                    Debater
                  </label>
                  <select
                    value={resMemberId}
                    onChange={(e) => setResMemberId(e.target.value)}
                    className="w-full rounded-xl border border-input bg-muted/30 px-2.5 py-2 text-xs"
                  >
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {memberDisplayName(m)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                    Partner
                  </label>
                  <select
                    value={resPartnerId}
                    onChange={(e) => setResPartnerId(e.target.value)}
                    className="w-full rounded-xl border border-input bg-muted/30 px-2.5 py-2 text-xs"
                  >
                    <option value="">None</option>
                    {members
                      .filter((m) => m.id !== resMemberId)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {memberDisplayName(m)}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                    Position
                  </label>
                  <select
                    value={resPosition}
                    onChange={(e) => setResPosition(e.target.value as RoomRole)}
                    className="w-full rounded-xl border border-input bg-muted/30 px-2 py-2 text-xs"
                  >
                    {ALL_ROOM_ROLES.map((pos) => (
                      <option key={pos} value={pos}>
                        {pos}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                    Rank
                  </label>
                  <select
                    value={resRank}
                    onChange={(e) => setResRank(Number(e.target.value) as 1 | 2 | 3 | 4)}
                    className="w-full rounded-xl border border-input bg-muted/30 px-2 py-2 text-xs"
                  >
                    <option value={1}>1st</option>
                    <option value={2}>2nd</option>
                    <option value={3}>3rd</option>
                    <option value={4}>4th</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                    Speaks
                  </label>
                  <input
                    type="number"
                    min={50}
                    max={100}
                    step={0.5}
                    value={resSpeaks}
                    onChange={(e) => setResSpeaks(Number(e.target.value))}
                    className="w-full rounded-xl border border-input bg-muted/30 px-2.5 py-2 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                  Chair Judge
                </label>
                <select
                  value={resChairId}
                  onChange={(e) => setResChairId(e.target.value)}
                  className="w-full rounded-xl border border-input bg-muted/30 px-2.5 py-2 text-xs"
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {memberDisplayName(m)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                  Notes / Feedback
                </label>
                <input
                  type="text"
                  value={resFeedback}
                  onChange={(e) => setResFeedback(e.target.value)}
                  placeholder="Optional feedback note..."
                  className="w-full rounded-xl border border-input bg-muted/30 px-3 py-2 text-xs"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition hover:opacity-95"
              >
                Save Result
              </button>
            </form>

            {/* Position Balance & Chair Exposure Matrices */}
            <div className="space-y-5 lg:col-span-8">
              <div className="rounded-2xl border border-border bg-white p-5 shadow-2xs">
                <h2 className="text-sm font-extrabold text-primary">
                  BP Position Balance &amp; Speaks Matrix
                </h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-[11px] font-bold uppercase text-muted-foreground">
                        <th className="py-2 pr-2">Member</th>
                        <th className="px-2 py-2">Avg Speaks</th>
                        <th className="px-2 py-2 text-center">OG</th>
                        <th className="px-2 py-2 text-center">OO</th>
                        <th className="px-2 py-2 text-center">CG</th>
                        <th className="px-2 py-2 text-center">CO</th>
                        <th className="px-2 py-2">Least Played</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {members
                        .filter((m) => m.permissions !== 'Pending')
                        .map((m) => {
                          const st = memberStats[m.id]
                          if (!st) return null
                          return (
                            <tr key={m.id}>
                              <td className="py-2 pr-2 font-semibold text-foreground">
                                {memberDisplayName(m)}{' '}
                                <span className="text-[10px] text-muted-foreground">
                                  ({m.rank})
                                </span>
                              </td>
                              <td className="px-2 py-2 font-mono font-bold">
                                {st.averageSpeaks ?? '—'}
                              </td>
                              <td className="px-2 py-2 text-center font-mono">
                                {st.positions['Opening Government']}
                              </td>
                              <td className="px-2 py-2 text-center font-mono">
                                {st.positions['Opening Opposition']}
                              </td>
                              <td className="px-2 py-2 text-center font-mono">
                                {st.positions['Closing Government']}
                              </td>
                              <td className="px-2 py-2 text-center font-mono">
                                {st.positions['Closing Opposition']}
                              </td>
                              <td className="px-2 py-2">
                                <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-semibold text-primary">
                                  {st.leastPlayedPosition}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-white p-5 shadow-2xs">
                <h2 className="text-sm font-extrabold text-primary">
                  Chair × Junior Exposure Matrix
                </h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-[11px] font-bold text-muted-foreground">
                        <th className="py-2 pr-3">Junior</th>
                        {chairJuniorMatrix.chairs.map((ch) => (
                          <th key={ch.id} className="px-2 py-2 text-center">
                            {memberDisplayName(ch)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {chairJuniorMatrix.juniors.map((jr) => (
                        <tr key={jr.id}>
                          <td className="py-2 pr-3 font-semibold text-foreground">
                            {memberDisplayName(jr)}
                          </td>
                          {chairJuniorMatrix.chairs.map((ch) => {
                            const count = chairJuniorMatrix.counts[jr.id]?.[ch.id] ?? 0
                            return (
                              <td key={ch.id} className="px-2 py-2 text-center font-mono">
                                <span
                                  className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold ${
                                    count === 0
                                      ? 'bg-muted text-muted-foreground'
                                      : 'bg-secondary text-primary'
                                  }`}
                                >
                                  {count}x
                                </span>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: CLUB ROSTER */}
        {activeTab === 'roster' && (
          <div className="space-y-5">
            {pendingMembers.length > 0 && (
              <section className="rounded-2xl border border-status-arrived/40 bg-white p-5 shadow-2xs">
                <h2 className="text-sm font-bold text-status-arrived">
                  Pending Google SSO Registrations ({pendingMembers.length})
                </h2>
                <div className="mt-3 space-y-2">
                  {pendingMembers.map((pm) => (
                    <div
                      key={pm.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/25 p-3"
                    >
                      <div>
                        <p className="text-xs font-bold text-foreground">
                          {pm.full_name_eng} ({pm.full_name_heb})
                        </p>
                        <p className="text-[11px] text-muted-foreground">{pm.email}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => actions.approvePendingMember(pm.id, 'Student')}
                        className="rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground"
                      >
                        ✓ Approve as Student (Junior)
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-2xl border border-border bg-white p-5 shadow-2xs">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-extrabold text-primary">Club Members</h2>
                <input
                  type="text"
                  value={rosterSearch}
                  onChange={(e) => setRosterSearch(e.target.value)}
                  placeholder="Search member..."
                  className="h-8 w-56 rounded-xl border border-input bg-muted/30 px-3 text-xs"
                />
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-[11px] font-bold uppercase text-muted-foreground">
                      <th className="py-2 pr-3">Name</th>
                      <th className="px-2 py-2">Email</th>
                      <th className="px-2 py-2">Rank</th>
                      <th className="px-2 py-2">Judging Level</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredRoster.map((m) => (
                      <tr key={m.id}>
                        <td className="py-2.5 pr-3 font-semibold text-foreground">
                          {m.full_name_eng}{' '}
                          <span className="text-muted-foreground">({m.full_name_heb})</span>
                        </td>
                        <td className="px-2 py-2.5 font-mono text-muted-foreground">{m.email}</td>
                        <td className="px-2 py-2.5">
                          <select
                            aria-label={`Rank for ${memberDisplayName(m)}`}
                            value={m.rank}
                            onChange={(e) =>
                              actions.updateMember(m.id, {
                                rank: e.target.value as 'Junior' | 'Senior',
                              })
                            }
                            className="rounded-lg border border-input bg-muted/30 px-2 py-1 text-xs font-semibold"
                          >
                            <option value="Junior">Junior</option>
                            <option value="Senior">Senior</option>
                          </select>
                        </td>
                        <td className="px-2 py-2.5">
                          <select
                            aria-label={`Judging level for ${memberDisplayName(m)}`}
                            value={m.official_judgement_level}
                            onChange={(e) =>
                              actions.updateMember(m.id, {
                                official_judgement_level: e.target.value as
                                  | 'Wing'
                                  | 'Chair'
                                  | 'CA',
                              })
                            }
                            className="rounded-lg border border-input bg-muted/30 px-2 py-1 text-xs"
                          >
                            <option value="Wing">Wing</option>
                            <option value="Chair">Chair</option>
                            <option value="CA">CA</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
