import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import BrandMark from '../../components/ui/BrandMark'
import PaletteSwitcher from '../../components/ui/PaletteSwitcher'
import {
  ALL_ROOM_ROLES,
  BP_POSITIONS,
  DEFAULT_PAIRING_OPTIONS,
  exportAssignmentsCsv,
  exportZoomBreakoutCsv,
  memberDisplayName,
} from '../domain/pairingEngine'
import { useTraining } from '../hooks/useTraining'
import type {
  BpPosition,
  LanguagePreference,
  PairingOptions,
  PairingStrategy,
  RolePreference,
  RoomRole,
  TrainingMember,
  TrainingRoomDraw,
} from '../types'

type TrainingTab = 'checkin' | 'draw' | 'results' | 'roster' | 'motions'

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
    results,
    motions,
    announcements,
    memberById,
    activeMember,
    isManagerOrAdmin,
    memberStats,
    chairJuniorMatrix,
    actions,
  } = useTraining()

  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<TrainingTab>(() => {
    const q = searchParams.get('tab') as TrainingTab | null
    if (q && ['checkin', 'draw', 'results', 'roster', 'motions'].includes(q)) {
      return q
    }
    return 'checkin'
  })

  useEffect(() => {
    const q = searchParams.get('tab') as TrainingTab | null
    if (q && ['checkin', 'draw', 'results', 'roster', 'motions'].includes(q)) {
      setActiveTab(q)
    }
  }, [searchParams])
  const [selectedSessionId, setSelectedSessionId] = useState<string>(
    () => sessions[0]?.id ?? '',
  )

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? sessions[0] ?? null,
    [sessions, selectedSessionId],
  )

  // Registration form state for the current activeMember
  const myRegistration = useMemo(
    () =>
      activeSession && activeMember
        ? registrations.find(
            (r) =>
              r.session_id === activeSession.id &&
              r.member_id === activeMember.id &&
              r.status !== 'Cancelled',
          ) ?? null
        : null,
    [activeSession, activeMember, registrations],
  )

  const [rolePref, setRolePref] = useState<RolePreference>(
    () => myRegistration?.role_preference ?? 'Debate',
  )
  const [langPref, setLangPref] = useState<LanguagePreference>(
    () => myRegistration?.language_preference ?? 'Hebrew',
  )
  const [partnerPref, setPartnerPref] = useState<string>(
    () => myRegistration?.partner_id ?? '',
  )
  const [regNotes, setRegNotes] = useState<string>(() => myRegistration?.notes ?? '')

  // Smart Pairing options
  const [pairingOptions, setPairingOptions] = useState<PairingOptions>(
    DEFAULT_PAIRING_OPTIONS,
  )
  const [drawRankFilter, setDrawRankFilter] = useState<'All' | 'Junior' | 'Senior'>('All')
  const [drawRoleFilter, setDrawRoleFilter] = useState<'All' | RolePreference>('All')
  const [quickAddMemberId, setQuickAddMemberId] = useState<string>('')

  // Google SSO Quick-Connect modal state
  const [ssoModalOpen, setSsoModalOpen] = useState(false)
  const [ssoEmail, setSsoEmail] = useState('')
  const [ssoNameHeb, setSsoNameHeb] = useState('')
  const [ssoNameEng, setSsoNameEng] = useState('')
  const [ssoTrack, setSsoTrack] = useState('')

  // New Session modal state
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [newSessionTitle, setNewSessionTitle] = useState('')
  const [newSessionDate, setNewSessionDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  )
  const [newSessionTime, setNewSessionTime] = useState('18:30')
  const [newSessionType, setNewSessionType] = useState<'Practice' | 'Lesson' | 'Tournament Prep'>('Practice')
  const [newSessionMotion, setNewSessionMotion] = useState('')
  const [newSessionInfoSlide, setNewSessionInfoSlide] = useState('')

  // Record Ballot / Result form state
  const [resMemberId, setResMemberId] = useState<string>(() => members[5]?.id ?? '')
  const [resPartnerId, setResPartnerId] = useState<string>(() => members[6]?.id ?? '')
  const [resChairId, setResChairId] = useState<string>(() => members[1]?.id ?? '')
  const [resPosition, setResPosition] = useState<RoomRole>('Closing Government')
  const [resRank, setResRank] = useState<1 | 2 | 3 | 4>(1)
  const [resSpeaks, setResSpeaks] = useState<number>(77)
  const [resPositive, setResPositive] = useState<string>('')
  const [resImprove, setResImprove] = useState<string>('')
  const [motionQuery, setMotionQuery] = useState<string>('')

  // Roster filter & selected profile
  const [rosterRankFilter, setRosterRankFilter] = useState<'All' | 'Junior' | 'Senior'>('All')
  const [rosterSearch, setRosterSearch] = useState('')
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)

  // Motion Bank form
  const [newMotionCategory, setNewMotionCategory] = useState('כלכלה וחברה')
  const [newMotionText, setNewMotionText] = useState('')
  const [newMotionInfo, setNewMotionInfo] = useState('')

  // Announcement form
  const [newAnnTitle, setNewAnnTitle] = useState('')
  const [newAnnBody, setNewAnnBody] = useState('')

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

  const handleSaveMyRegistration = (checkInImmediately: boolean) => {
    if (!activeSession || !activeMember) return
    actions.upsertRegistration({
      sessionId: activeSession.id,
      memberId: activeMember.id,
      status: checkInImmediately
        ? 'CheckedIn'
        : myRegistration?.status ?? 'Registered',
      rolePreference: rolePref,
      languagePreference: langPref,
      partnerId: partnerPref || null,
      notes: regNotes,
    })
  }

  const handleRunSmartDraw = () => {
    if (!activeSession) return
    actions.runSmartAutoFill(activeSession.id, pairingOptions)
  }

  const handleMoveMemberInDraw = (
    memberId: string,
    targetRoomId: string | 'waitlist' | 'trash',
    targetRole?: RoomRole,
  ) => {
    if (!activeSession) return
    const nextDraw = structuredClone(activeSession.draw)

    // Remove memberId from all rooms, waitlist, trash
    for (const r of nextDraw.rooms) {
      for (const role of ALL_ROOM_ROLES) {
        r[role] = r[role].filter((id) => id !== memberId)
      }
    }
    nextDraw.waitlist = nextDraw.waitlist.filter((id) => id !== memberId)
    nextDraw.trash = nextDraw.trash.filter((id) => id !== memberId)

    if (targetRoomId === 'waitlist') {
      nextDraw.waitlist.push(memberId)
    } else if (targetRoomId === 'trash') {
      nextDraw.trash.push(memberId)
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
      explanations: ['Manually added room'],
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
      .filter(({ reg, member }) => {
        if (drawRankFilter !== 'All' && member.rank !== drawRankFilter) return false
        if (drawRoleFilter !== 'All' && reg.role_preference !== drawRoleFilter) return false
        return true
      })
  }, [sessionRegistrations, assignedMemberIdsInDraw, memberById, drawRankFilter, drawRoleFilter])

  const handleGoogleSsoSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!ssoEmail.trim()) return
    const member = actions.signInOrRegisterGoogleMember({
      email: ssoEmail,
      fullNameHeb: ssoNameHeb,
      fullNameEng: ssoNameEng,
      studentTrack: ssoTrack,
    })
    setSsoModalOpen(false)
    setSsoEmail('')
    setSsoNameHeb('')
    setSsoNameEng('')
    setSsoTrack('')
    if (activeSession) {
      actions.upsertRegistration({
        sessionId: activeSession.id,
        memberId: member.id,
        status: 'CheckedIn',
        rolePreference: 'Debate',
        languagePreference: 'Hebrew',
      })
    }
  }

  const handleCreateSession = (e: FormEvent) => {
    e.preventDefault()
    if (!newSessionTitle.trim()) return
    const created = actions.createSession({
      title: newSessionTitle,
      date: newSessionDate,
      time: newSessionTime,
      event_type: newSessionType,
      motion: newSessionMotion,
      info_slide: newSessionInfoSlide,
    })
    setSelectedSessionId(created.id)
    setNewSessionOpen(false)
    setNewSessionTitle('')
    setNewSessionMotion('')
    setNewSessionInfoSlide('')
  }

  const handleRecordResult = (e: FormEvent) => {
    e.preventDefault()
    if (!resMemberId) return
    actions.recordResult({
      session_id: activeSession?.id ?? null,
      session_date: activeSession?.date ?? new Date().toISOString().slice(0, 10),
      room_name: activeSession?.draw.rooms[0]?.room_name ?? 'A206',
      member_id: resMemberId,
      partner_id: resPosition === 'Chair' || resPosition === 'Panel' ? null : resPartnerId || null,
      chair_id: resPosition === 'Chair' ? null : resChairId || null,
      position: resPosition,
      team_rank: resPosition === 'Chair' || resPosition === 'Panel' ? null : resRank,
      speaker_points: resPosition === 'Chair' || resPosition === 'Panel' ? null : resSpeaks,
      motion: activeSession?.motion ?? '',
      info_slide: activeSession?.info_slide ?? '',
      positive_feedback: resPositive.trim(),
      improvement_feedback: resImprove.trim(),
    })
    setResPositive('')
    setResImprove('')
  }

  const filteredResults = useMemo(() => {
    const q = motionQuery.trim().toLowerCase()
    if (!q) return results
    return results.filter((r) => {
      const m = memberById.get(r.member_id)
      const name = memberDisplayName(m).toLowerCase()
      return (
        r.motion.toLowerCase().includes(q) ||
        r.info_slide.toLowerCase().includes(q) ||
        name.includes(q) ||
        r.position.toLowerCase().includes(q)
      )
    })
  }, [results, motionQuery, memberById])

  const filteredRoster = useMemo(() => {
    const q = rosterSearch.trim().toLowerCase()
    return members.filter((m) => {
      if (rosterRankFilter !== 'All' && m.rank !== rosterRankFilter) return false
      if (!q) return true
      return (
        m.full_name_heb.toLowerCase().includes(q) ||
        m.full_name_eng.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.student_track.toLowerCase().includes(q)
      )
    })
  }, [members, rosterRankFilter, rosterSearch])

  const selectedProfile = selectedProfileId ? memberById.get(selectedProfileId) ?? null : null

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <BrandMark className="size-9" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                  IDC Debate — Training & Smart BP Draw
                </h1>
                <span className="rounded-full bg-status-debate/15 px-2.5 py-0.5 text-[11px] font-semibold text-status-debate">
                  Training System
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Google SSO Member Portal • History-Aware Pairing & Position Balancing
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <PaletteSwitcher />

            <Link
              to="/"
              className="rounded-full border border-border bg-white px-3.5 py-1.5 text-xs font-bold text-primary shadow-2xs transition hover:bg-secondary/40"
            >
              ← Main Office
            </Link>

            {/* Persona / Google SSO Switcher */}
            <div className="flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3 py-1">
              <span className="text-[11px] font-semibold text-muted-foreground">Signed in:</span>
              <select
                aria-label="Active member persona"
                value={activeMember?.id ?? ''}
                onChange={(e) => actions.setActivePersona(e.target.value)}
                className="rounded bg-transparent text-xs font-semibold text-foreground outline-none"
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {memberDisplayName(m)} ({m.rank} • {m.permissions})
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => setSsoModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-2xs transition hover:bg-muted"
            >
              <span className="size-2 rounded-full bg-status-finished" />
              + Google SSO Join
            </button>

            <Link
              to={activeSession ? `/training/projection?session=${activeSession.id}` : '/training/projection'}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted"
            >
              Projector View
            </Link>

            <Link
              to="/admin"
              className="rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground transition hover:opacity-95"
            >
              Screening Queue
            </Link>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <nav className="flex gap-1 overflow-x-auto border-t border-border/60 pt-2" role="tablist">
            {(
              [
                ['checkin', '1. Practice & Check-In'],
                ['draw', '2. Smart BP Room Draw'],
                ['results', '3. Ballots & Knowledge Matrix'],
                ['roster', `4. Club Roster (${members.length})`],
                ['motions', '5. Motions & Announcements'],
              ] as const
            ).map(([tabKey, label]) => (
              <button
                key={tabKey}
                type="button"
                role="tab"
                aria-selected={activeTab === tabKey}
                onClick={() => setActiveTab(tabKey)}
                className={`border-b-2 px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition sm:text-sm ${
                  activeTab === tabKey
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
                {tabKey === 'roster' && pendingMembers.length > 0 && (
                  <span className="ms-1.5 rounded-full bg-status-arrived px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                    {pendingMembers.length} new
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {/* Session Selector Banner */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-2xs">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Active Training Session:
            </label>
            <select
              aria-label="Select training session"
              value={activeSession?.id ?? ''}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-semibold text-foreground outline-none focus:ring-2 focus:ring-ring"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.date} ({s.time}) — {s.title} [{s.status}]
                </option>
              ))}
            </select>
            {activeSession && (
              <span className="rounded-full bg-status-finished/15 px-2.5 py-0.5 text-xs font-semibold text-status-finished">
                {sessionRegistrations.filter((r) => r.status === 'CheckedIn').length} Checked In /{' '}
                {sessionRegistrations.length} Registered
              </span>
            )}
          </div>

          {isManagerOrAdmin && (
            <button
              type="button"
              onClick={() => setNewSessionOpen(true)}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              + Plan New Training
            </button>
          )}
        </section>

        {/* TAB 1: PRACTICE & CHECK-IN */}
        {activeTab === 'checkin' && activeSession && (
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Left Column: Member Registration & Check-In Card */}
            <div className="space-y-5 lg:col-span-5">
              <div className="rounded-xl border border-border bg-card p-5 shadow-2xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-status-debate">
                      Member Check-In & Role Choice
                    </span>
                    <h2 className="mt-1 text-base font-bold text-foreground">
                      {memberDisplayName(activeMember)}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {activeMember?.email} • Rank: <strong>{activeMember?.rank}</strong> • Least Practiced:{' '}
                      <strong>{memberStats[activeMember?.id ?? '']?.leastPlayedPosition}</strong>
                    </p>
                  </div>
                  {myRegistration && (
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                        myRegistration.status === 'CheckedIn'
                          ? 'bg-status-finished/15 text-status-finished'
                          : 'bg-status-arrived/15 text-status-arrived'
                      }`}
                    >
                      {myRegistration.status === 'CheckedIn' ? '✓ Checked In' : 'Registered'}
                    </span>
                  )}
                </div>

                <div className="mt-4 space-y-3.5">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                      How are you participating today? (Debater / Judge)
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['Debate', 'Judge', 'No preference'] as const).map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setRolePref(r)}
                          className={`rounded-md border px-2.5 py-2 text-xs font-semibold transition ${
                            rolePref === r
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-background text-foreground hover:bg-muted'
                          }`}
                        >
                          {r === 'Debate'
                            ? '🎤 Debater'
                            : r === 'Judge'
                              ? '⚖️ Judge'
                              : '🔄 Flex / Either'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                        Language Preference
                      </label>
                      <select
                        value={langPref}
                        onChange={(e) => setLangPref(e.target.value as LanguagePreference)}
                        className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-xs font-medium"
                      >
                        <option value="Hebrew">Hebrew (עברית)</option>
                        <option value="English">English (אנגלית)</option>
                        <option value="No preference">No preference</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                        Partner Request (Optional)
                      </label>
                      <select
                        value={partnerPref}
                        onChange={(e) => setPartnerPref(e.target.value)}
                        disabled={rolePref === 'Judge'}
                        className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-xs font-medium disabled:opacity-50"
                      >
                        <option value="">No specific partner (Auto-Pair)</option>
                        {members
                          .filter((m) => m.id !== activeMember?.id && m.permissions !== 'Pending')
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {memberDisplayName(m)} ({m.rank})
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                      Notes for Equity / Training Manager
                    </label>
                    <input
                      type="text"
                      value={regNotes}
                      onChange={(e) => setRegNotes(e.target.value)}
                      placeholder="e.g., Arriving at 18:40 / Want to practice Closing..."
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => handleSaveMyRegistration(true)}
                      className="flex-1 rounded-md bg-status-finished px-4 py-2.5 text-xs font-bold text-white shadow-2xs transition hover:brightness-110"
                    >
                      ✓ Check In — I Am Here!
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveMyRegistration(false)}
                      className="rounded-md border border-border bg-background px-3 py-2.5 text-xs font-semibold text-foreground hover:bg-muted"
                    >
                      Save Preferences
                    </button>
                    {myRegistration && (
                      <button
                        type="button"
                        onClick={() =>
                          activeMember &&
                          actions.cancelRegistration(activeSession.id, activeMember.id)
                        }
                        className="rounded-md border border-destructive/30 bg-late-surface px-3 py-2.5 text-xs font-semibold text-destructive hover:brightness-95"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Pinned Club Announcements */}
              <div className="rounded-xl border border-border bg-card p-5 shadow-2xs">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Club Announcements
                </h3>
                <div className="mt-3 space-y-3" dir="rtl">
                  {announcements.slice(0, 2).map((ann) => (
                    <div key={ann.id} className="rounded-lg border border-border bg-muted/30 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-foreground">{ann.title}</p>
                        {ann.pinned && (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                            נעוץ
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{ann.body}</p>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">— {ann.author_name}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Live Session Check-In Roster */}
            <div className="space-y-5 lg:col-span-7">
              <div className="rounded-xl border border-border bg-card p-5 shadow-2xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-bold text-foreground" dir="rtl">
                      {activeSession.title}
                    </h2>
                    <p className="text-xs text-muted-foreground" dir="rtl">
                      {activeSession.notes}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      handleRunSmartDraw()
                      setActiveTab('draw')
                    }}
                    className="rounded-md bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground shadow-2xs transition hover:bg-primary/90"
                  >
                    ⚡ Auto-Fill Rooms & Open Draw →
                  </button>
                </div>

                {/* Quick Add Member from Club Database */}
                {isManagerOrAdmin && (
                  <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-2.5">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Quick Check-In Member:
                    </span>
                    <select
                      aria-label="Quick check-in member from roster"
                      value={quickAddMemberId}
                      onChange={(e) => setQuickAddMemberId(e.target.value)}
                      className="flex-1 rounded border border-input bg-card px-2.5 py-1.5 text-xs"
                    >
                      <option value="">Select a club member to check in...</option>
                      {members
                        .filter(
                          (m) =>
                            m.permissions !== 'Pending' &&
                            !sessionRegistrations.some((r) => r.member_id === m.id),
                        )
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {memberDisplayName(m)} ({m.rank} • {m.email})
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      disabled={!quickAddMemberId}
                      onClick={() => {
                        if (!quickAddMemberId) return
                        actions.upsertRegistration({
                          sessionId: activeSession.id,
                          memberId: quickAddMemberId,
                          status: 'CheckedIn',
                          rolePreference: 'Debate',
                          languagePreference: 'Hebrew',
                        })
                        setQuickAddMemberId('')
                      }}
                      className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      + Check In as Debater
                    </button>
                  </div>
                )}

                {/* Attendance Table */}
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-[11px] font-bold uppercase text-muted-foreground">
                        <th className="py-2 pr-3">Member</th>
                        <th className="px-2 py-2">Rank</th>
                        <th className="px-2 py-2">Role Choice</th>
                        <th className="px-2 py-2">Partner Request</th>
                        <th className="px-2 py-2">Least Played Position</th>
                        <th className="px-2 py-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {sessionRegistrations.map((reg) => {
                        const m = memberById.get(reg.member_id)
                        if (!m) return null
                        const partner = reg.partner_id ? memberById.get(reg.partner_id) : null
                        const st = memberStats[m.id]
                        return (
                          <tr key={reg.id} className="hover:bg-muted/30">
                            <td className="py-2.5 pr-3 font-semibold text-foreground">
                              {memberDisplayName(m)}
                              {reg.notes && (
                                <span className="block text-[11px] font-normal text-muted-foreground">
                                  {reg.notes}
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-2.5">
                              <span
                                className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                                  m.rank === 'Senior'
                                    ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300'
                                    : 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                                }`}
                              >
                                {m.rank}
                              </span>
                            </td>
                            <td className="px-2 py-2.5">
                              <span
                                className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                                  reg.role_preference === 'Judge'
                                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                    : reg.role_preference === 'Debate'
                                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                      : 'bg-muted text-muted-foreground'
                                }`}
                              >
                                {reg.role_preference}
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-muted-foreground">
                              {partner ? memberDisplayName(partner) : 'Auto-Pair'}
                            </td>
                            <td className="px-2 py-2.5">
                              {st ? (
                                <span className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-foreground">
                                  {st.leastPlayedPosition} ({st.positions[st.leastPlayedPosition]}x)
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-2 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => actions.toggleCheckIn(activeSession.id, m.id)}
                                className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                                  reg.status === 'CheckedIn'
                                    ? 'bg-status-finished/15 text-status-finished hover:bg-status-finished/25'
                                    : 'bg-status-arrived/15 text-status-arrived hover:bg-status-arrived/25'
                                }`}
                              >
                                {reg.status === 'CheckedIn' ? '✓ Checked In' : 'Mark Arrived'}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: SMART BP ROOM DRAW */}
        {activeTab === 'draw' && activeSession && (
          <div className="space-y-6">
            {/* Smart Pairing Controls Card */}
            <section className="rounded-xl border border-border bg-card p-5 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-status-debate">
                    Smart Pairing & Position-Balancing Engine
                  </span>
                  <h2 className="mt-0.5 text-base font-bold text-foreground">
                    Configure Auto-Fill Algorithm
                  </h2>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRunSmartDraw}
                    className="rounded-md bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-2xs transition hover:bg-primary/90"
                  >
                    ⚡ Smart Auto-Fill Rooms
                  </button>
                  <button
                    type="button"
                    onClick={handleAddRoomToDraw}
                    className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted"
                  >
                    + Add Room
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadCsvFile(
                        `IDC-Assignments-${activeSession.date}.csv`,
                        exportAssignmentsCsv(activeSession.draw.rooms, memberById),
                      )
                    }
                    className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted"
                  >
                    Export Assignments CSV
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadCsvFile(
                        `IDC-ZoomBreakout-${activeSession.date}.csv`,
                        exportZoomBreakoutCsv(activeSession.draw.rooms, memberById),
                      )
                    }
                    className="rounded-md border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted"
                  >
                    Export Zoom CSV
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 border-t border-border pt-4 md:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Pairing Strategy
                  </label>
                  <select
                    aria-label="Pairing strategy"
                    value={pairingOptions.strategy}
                    onChange={(e) =>
                      setPairingOptions((prev) => ({
                        ...prev,
                        strategy: e.target.value as PairingStrategy,
                      }))
                    }
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-semibold"
                  >
                    <option value="balanced-history">
                      Balanced History (Avoid Repeat Partners)
                    </option>
                    <option value="pro-am">Pro-Am (Senior Mentor + 1st-Year Junior)</option>
                    <option value="skill-matched">
                      Skill-Matched (Power-Pair by Avg Speaks)
                    </option>
                    <option value="random">Random Draw</option>
                  </select>
                </div>

                <label className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 p-3 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={pairingOptions.honorPartnerRequests}
                    onChange={(e) =>
                      setPairingOptions((prev) => ({
                        ...prev,
                        honorPartnerRequests: e.target.checked,
                      }))
                    }
                  />
                  <span>
                    <strong className="block text-foreground">Honor Partner Requests</strong>
                    Lock requested pairs before auto-pairing
                  </span>
                </label>

                <label className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 p-3 text-xs font-medium">
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
                  <span>
                    <strong className="block text-foreground">Balance BP Positions</strong>
                    Assign teams to least-played OG/OO/CG/CO
                  </span>
                </label>

                <label className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 p-3 text-xs font-medium">
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
                  <span>
                    <strong className="block text-foreground">Rotate Chairs Across Juniors</strong>
                    Prioritize Chairs who haven&apos;t judged room Juniors
                  </span>
                </label>
              </div>
            </section>

            {/* Unassigned / Waitlist Pool */}
            {unassignedRegisteredMembers.length > 0 && (
              <section className="rounded-xl border border-status-arrived/40 bg-card p-4 shadow-2xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-status-arrived">
                    Unassigned / Waitlist Pool ({unassignedRegisteredMembers.length})
                  </h3>
                  <div className="flex items-center gap-2 text-xs">
                    <select
                      value={drawRankFilter}
                      onChange={(e) => setDrawRankFilter(e.target.value as 'All' | 'Junior' | 'Senior')}
                      className="rounded border border-input bg-background px-2 py-1"
                    >
                      <option value="All">All Ranks</option>
                      <option value="Junior">Juniors Only</option>
                      <option value="Senior">Seniors Only</option>
                    </select>
                    <select
                      value={drawRoleFilter}
                      onChange={(e) => setDrawRoleFilter(e.target.value as 'All' | RolePreference)}
                      className="rounded border border-input bg-background px-2 py-1"
                    >
                      <option value="All">All Roles</option>
                      <option value="Debate">Debate</option>
                      <option value="Judge">Judge</option>
                    </select>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {unassignedRegisteredMembers.map(({ reg, member }) => (
                    <div
                      key={member.id}
                      className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs"
                    >
                      <span className="font-semibold text-foreground">
                        {memberDisplayName(member)}
                      </span>
                      <span className="rounded bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {member.rank} • {reg.role_preference}
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
                          className="rounded border border-input bg-card px-1.5 py-0.5 text-[11px]"
                        >
                          <option value="">+ Assign to...</option>
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
            <div className="grid gap-6 lg:grid-cols-2">
              {activeSession.draw.rooms.map((room) => (
                <div
                  key={room.id}
                  className="overflow-hidden rounded-xl border border-border bg-card shadow-2xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-extrabold text-foreground">
                        Room {room.room_name}
                      </span>
                      <span className="rounded-full bg-card px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                        {room.language}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <div className="flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1">
                        <span className="font-bold text-status-arrived">Chair:</span>
                        <span>
                          {room.Chair.map((id) => memberDisplayName(memberById.get(id))).join(', ') ||
                            'Unassigned'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1">
                        <span className="font-bold text-status-debate">Panel:</span>
                        <span>
                          {room.Panel.map((id) => memberDisplayName(memberById.get(id))).join(', ') ||
                            'None'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 4 BP Benches */}
                  <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
                    {BP_POSITIONS.map((pos: BpPosition) => {
                      const memberIds = room[pos]
                      return (
                        <div
                          key={pos}
                          className="rounded-lg border border-border bg-background p-3"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                              {pos}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {memberIds.length}/2
                            </span>
                          </div>

                          <ul className="mt-2 space-y-1.5">
                            {memberIds.map((memberId) => {
                              const m = memberById.get(memberId)
                              const st = memberStats[memberId]
                              const posCount = st?.positions[pos] ?? 0
                              return (
                                <li
                                  key={memberId}
                                  className="flex items-center justify-between gap-1 rounded border border-border/70 bg-card px-2.5 py-1.5 text-xs"
                                >
                                  <div>
                                    <span className="font-semibold text-foreground">
                                      {memberDisplayName(m)}
                                    </span>
                                    <span className="ms-1.5 text-[10px] text-muted-foreground">
                                      ({m?.rank} • prior {posCount}x)
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    title="Move to unassigned pool"
                                    onClick={() => handleMoveMemberInDraw(memberId, 'waitlist')}
                                    className="text-[11px] text-muted-foreground hover:text-destructive"
                                  >
                                    ✕
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      )
                    })}
                  </div>

                  {/* Algorithm Explainability Footer */}
                  {room.explanations && room.explanations.length > 0 && (
                    <div className="border-t border-border bg-muted/25 px-4 py-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        Why the Smart Engine Built This Room:
                      </p>
                      <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                        {room.explanations.map((exp, idx) => (
                          <li key={idx}>• {exp}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: BALLOTS, RESULTS & KNOWLEDGE MATRIX */}
        {activeTab === 'results' && (
          <div className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-12">
              {/* Record Ballot / Round Result Form */}
              <form
                onSubmit={handleRecordResult}
                className="space-y-3.5 rounded-xl border border-border bg-card p-5 shadow-2xs lg:col-span-5"
              >
                <span className="text-xs font-bold uppercase tracking-wider text-status-debate">
                  Judge Ballot & Feedback Entry
                </span>
                <h2 className="text-base font-bold text-foreground">
                  Record Round Score & Personal Feedback
                </h2>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                      Debater
                    </label>
                    <select
                      value={resMemberId}
                      onChange={(e) => setResMemberId(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-xs"
                    >
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {memberDisplayName(m)} ({m.rank})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                      Partner
                    </label>
                    <select
                      value={resPartnerId}
                      onChange={(e) => setResPartnerId(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-xs"
                    >
                      <option value="">None / Solo</option>
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

                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                      BP Position
                    </label>
                    <select
                      value={resPosition}
                      onChange={(e) => setResPosition(e.target.value as RoomRole)}
                      className="w-full rounded-md border border-input bg-background px-2 py-2 text-xs"
                    >
                      {ALL_ROOM_ROLES.map((pos) => (
                        <option key={pos} value={pos}>
                          {pos}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                      Team Rank (1–4)
                    </label>
                    <select
                      value={resRank}
                      onChange={(e) => setResRank(Number(e.target.value) as 1 | 2 | 3 | 4)}
                      className="w-full rounded-md border border-input bg-background px-2 py-2 text-xs"
                    >
                      <option value={1}>1st Place</option>
                      <option value={2}>2nd Place</option>
                      <option value={3}>3rd Place</option>
                      <option value={4}>4th Place</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                      Speaker Points
                    </label>
                    <input
                      type="number"
                      min={50}
                      max={100}
                      step={0.5}
                      value={resSpeaks}
                      onChange={(e) => setResSpeaks(Number(e.target.value))}
                      className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Chair / Adjudicator
                  </label>
                  <select
                    value={resChairId}
                    onChange={(e) => setResChairId(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-xs"
                  >
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {memberDisplayName(m)} ({m.official_judgement_level})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Positive Feedback (נקודות לשימור)
                  </label>
                  <textarea
                    rows={2}
                    dir="rtl"
                    value={resPositive}
                    onChange={(e) => setResPositive(e.target.value)}
                    placeholder="מה עבד מצוין בנאום..."
                    className="w-full rounded-md border border-input bg-background p-2 text-xs"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Points for Improvement (נקודות לשיפור לאימון הבא)
                  </label>
                  <textarea
                    rows={2}
                    dir="rtl"
                    value={resImprove}
                    onChange={(e) => setResImprove(e.target.value)}
                    placeholder="על מה כדאי לעבוד לקראת הסיבוב הבא..."
                    className="w-full rounded-md border border-input bg-background p-2 text-xs"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full rounded-md bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground transition hover:bg-primary/90"
                >
                  Save Result & Update Knowledge Matrix
                </button>
              </form>

              {/* Knowledge Matrix 1: BP Position Distribution & Least-Played Tracker */}
              <div className="space-y-5 lg:col-span-7">
                <div className="rounded-xl border border-border bg-card p-5 shadow-2xs">
                  <h3 className="text-sm font-bold text-foreground">
                    BP Position Balance & Speaks Matrix (Organizing Club Knowledge)
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Tracks how many times each member has debated in OG, OO, CG, CO so the Smart Draw automatically fills gaps.
                  </p>

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
                          <th className="px-2 py-2 text-center">Chair</th>
                          <th className="px-2 py-2">Next Recommended</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {members
                          .filter((m) => m.permissions !== 'Pending')
                          .map((m) => {
                            const st = memberStats[m.id]
                            if (!st) return null
                            return (
                              <tr key={m.id} className="hover:bg-muted/30">
                                <td className="py-2 pr-2 font-semibold text-foreground">
                                  {memberDisplayName(m)}{' '}
                                  <span className="text-[10px] text-muted-foreground">
                                    ({m.rank})
                                  </span>
                                </td>
                                <td className="px-2 py-2 font-mono font-bold text-foreground">
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
                                <td className="px-2 py-2 text-center font-mono">
                                  {st.positions.Chair}
                                </td>
                                <td className="px-2 py-2">
                                  <span className="rounded bg-status-debate/15 px-2 py-0.5 text-[11px] font-semibold text-status-debate">
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

                {/* Knowledge Matrix 2: Chair × Junior Exposure Matrix */}
                <div className="rounded-xl border border-border bg-card p-5 shadow-2xs">
                  <h3 className="text-sm font-bold text-foreground">
                    Chair × Junior Exposure Matrix
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    How many times each Chair has judged each 1st-year Junior (0 = prioritized next by Smart Draw).
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border text-[11px] font-bold text-muted-foreground">
                          <th className="py-2 pr-3">Junior Debater</th>
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
                                    className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${
                                      count === 0
                                        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                        : 'bg-status-finished/15 text-status-finished'
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

            {/* Debate History & Personal Feedback Table */}
            <section className="rounded-xl border border-border bg-card p-5 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base font-bold text-foreground">
                  Debate History & Personal Judge Feedbacks ({filteredResults.length})
                </h3>
                <input
                  type="text"
                  value={motionQuery}
                  onChange={(e) => setMotionQuery(e.target.value)}
                  placeholder="Search by motion, debater, or position..."
                  className="w-64 rounded-md border border-input bg-background px-3 py-1.5 text-xs"
                />
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-[11px] font-bold uppercase text-muted-foreground">
                      <th className="py-2 pr-2">Date</th>
                      <th className="px-2 py-2">Debater</th>
                      <th className="px-2 py-2">Partner</th>
                      <th className="px-2 py-2">Chair</th>
                      <th className="px-2 py-2">Position</th>
                      <th className="px-2 py-2">Rank</th>
                      <th className="px-2 py-2">Speaks</th>
                      <th className="px-2 py-2">Motion & Feedback</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredResults.map((r) => {
                      const debater = memberById.get(r.member_id)
                      const partner = r.partner_id ? memberById.get(r.partner_id) : null
                      const chair = r.chair_id ? memberById.get(r.chair_id) : null
                      return (
                        <tr key={r.id} className="align-top hover:bg-muted/30">
                          <td className="py-2.5 pr-2 whitespace-nowrap text-muted-foreground">
                            {r.session_date}
                          </td>
                          <td className="px-2 py-2.5 font-semibold text-foreground">
                            {memberDisplayName(debater)}
                          </td>
                          <td className="px-2 py-2.5 text-muted-foreground">
                            {partner ? memberDisplayName(partner) : '—'}
                          </td>
                          <td className="px-2 py-2.5 text-muted-foreground">
                            {chair ? memberDisplayName(chair) : '—'}
                          </td>
                          <td className="px-2 py-2.5 font-medium">{r.position}</td>
                          <td className="px-2 py-2.5 font-bold">
                            {r.team_rank ? `#${r.team_rank}` : '—'}
                          </td>
                          <td className="px-2 py-2.5 font-mono font-bold">
                            {r.speaker_points ?? '—'}
                          </td>
                          <td className="max-w-md px-2 py-2.5" dir="rtl">
                            <p className="font-semibold text-foreground">{r.motion}</p>
                            {r.positive_feedback && (
                              <p className="mt-1 text-[11px] text-status-finished">
                                <strong>לשימור:</strong> {r.positive_feedback}
                              </p>
                            )}
                            {r.improvement_feedback && (
                              <p className="mt-0.5 text-[11px] text-status-arrived">
                                <strong>לשיפור:</strong> {r.improvement_feedback}
                              </p>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* TAB 4: CLUB ROSTER & GOOGLE SSO APPROVALS */}
        {activeTab === 'roster' && (
          <div className="space-y-6">
            {pendingMembers.length > 0 && (
              <section className="rounded-xl border border-status-arrived/40 bg-card p-5 shadow-2xs">
                <h2 className="text-sm font-bold text-status-arrived">
                  Pending Google SSO Registrations ({pendingMembers.length})
                </h2>
                <p className="text-xs text-muted-foreground">
                  Approve new club members who authenticated with Google SSO so they can join trainings.
                </p>
                <div className="mt-3 space-y-2">
                  {pendingMembers.map((pm) => (
                    <div
                      key={pm.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3"
                    >
                      <div>
                        <p className="text-sm font-bold text-foreground">
                          {memberDisplayName(pm)} ({pm.full_name_eng})
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {pm.email} • {pm.student_track} • {pm.extra_info}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => actions.approvePendingMember(pm.id, 'Student')}
                          className="rounded-md bg-status-finished px-3 py-1.5 text-xs font-bold text-white"
                        >
                          ✓ Approve as Student (Junior)
                        </button>
                        <button
                          type="button"
                          onClick={() => actions.approvePendingMember(pm.id, 'Manager')}
                          className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground"
                        >
                          Approve as Manager
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-xl border border-border bg-card p-5 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={rosterSearch}
                    onChange={(e) => setRosterSearch(e.target.value)}
                    placeholder="Search member by name, email, or track..."
                    className="w-64 rounded-md border border-input bg-background px-3 py-1.5 text-xs"
                  />
                  <select
                    value={rosterRankFilter}
                    onChange={(e) => setRosterRankFilter(e.target.value as 'All' | 'Junior' | 'Senior')}
                    className="rounded-md border border-input bg-background px-2.5 py-1.5 text-xs"
                  >
                    <option value="All">All Ranks</option>
                    <option value="Junior">Juniors (1st Year)</option>
                    <option value="Senior">Seniors</option>
                  </select>
                </div>

                {isManagerOrAdmin && (
                  <button
                    type="button"
                    onClick={() => actions.promoteAllJuniorsToSeniors()}
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
                  >
                    Promote All Juniors → Seniors
                  </button>
                )}
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-[11px] font-bold uppercase text-muted-foreground">
                      <th className="py-2 pr-3">Name</th>
                      <th className="px-2 py-2">Email</th>
                      <th className="px-2 py-2">Track & Year</th>
                      <th className="px-2 py-2">Rank</th>
                      <th className="px-2 py-2">Judging Level</th>
                      <th className="px-2 py-2">Role</th>
                      <th className="px-2 py-2 text-right">Profile</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredRoster.map((m) => (
                      <tr key={m.id} className="hover:bg-muted/30">
                        <td className="py-2.5 pr-3 font-semibold text-foreground">
                          {m.full_name_heb}
                          <span className="block text-[11px] font-normal text-muted-foreground">
                            {m.full_name_eng}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 font-mono text-muted-foreground">{m.email}</td>
                        <td className="px-2 py-2.5 text-muted-foreground">
                          {m.student_track || '—'} ({m.start_year})
                        </td>
                        <td className="px-2 py-2.5">
                          <select
                            aria-label={`Rank for ${memberDisplayName(m)}`}
                            value={m.rank}
                            onChange={(e) =>
                              actions.updateMember(m.id, {
                                rank: e.target.value as 'Junior' | 'Senior',
                              })
                            }
                            className="rounded border border-input bg-background px-2 py-1 text-xs font-semibold"
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
                                official_judgement_level: e.target.value as 'Wing' | 'Chair' | 'CA',
                              })
                            }
                            className="rounded border border-input bg-background px-2 py-1 text-xs"
                          >
                            <option value="Wing">Wing</option>
                            <option value="Chair">Chair</option>
                            <option value="CA">CA</option>
                          </select>
                        </td>
                        <td className="px-2 py-2.5">
                          <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-semibold">
                            {m.permissions}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedProfileId(m.id)}
                            className="rounded border border-border bg-background px-2.5 py-1 text-xs font-semibold hover:bg-muted"
                          >
                            View Stats
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Selected Member Profile Modal */}
            {selectedProfile && (
              <section className="rounded-xl border border-primary/30 bg-card p-5 shadow-md">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-bold text-foreground">
                      {memberDisplayName(selectedProfile)} — Personal Debater Portfolio
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {selectedProfile.email} • {selectedProfile.rank} • Avg Speaks:{' '}
                      <strong>{memberStats[selectedProfile.id]?.averageSpeaks ?? '—'}</strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedProfileId(null)}
                    className="rounded border border-border px-2.5 py-1 text-xs font-semibold"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-6">
                  {ALL_ROOM_ROLES.map((role) => (
                    <div
                      key={role}
                      className="rounded-lg border border-border bg-muted/30 p-2.5 text-center"
                    >
                      <p className="text-[10px] font-bold uppercase text-muted-foreground">{role}</p>
                      <p className="mt-1 font-mono text-lg font-extrabold text-foreground">
                        {memberStats[selectedProfile.id]?.positions[role] ?? 0}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* TAB 5: MOTIONS & ANNOUNCEMENTS */}
        {activeTab === 'motions' && (
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Motion Bank */}
            <div className="space-y-4 lg:col-span-7">
              <div className="rounded-xl border border-border bg-card p-5 shadow-2xs">
                <h2 className="text-base font-bold text-foreground">Club Motion Bank</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!newMotionText.trim()) return
                    actions.addMotion({
                      category: newMotionCategory,
                      motion: newMotionText,
                      info_slide: newMotionInfo,
                    })
                    setNewMotionText('')
                    setNewMotionInfo('')
                  }}
                  className="mt-3 space-y-2.5 border-b border-border pb-4"
                >
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newMotionCategory}
                      onChange={(e) => setNewMotionCategory(e.target.value)}
                      placeholder="Category..."
                      className="w-40 rounded border border-input bg-background px-2.5 py-1.5 text-xs"
                    />
                    <input
                      type="text"
                      dir="rtl"
                      value={newMotionText}
                      onChange={(e) => setNewMotionText(e.target.value)}
                      placeholder="ב״ז יחייב..."
                      className="flex-1 rounded border border-input bg-background px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      dir="rtl"
                      value={newMotionInfo}
                      onChange={(e) => setNewMotionInfo(e.target.value)}
                      placeholder="שקופית מידע (אופציונלי)..."
                      className="flex-1 rounded border border-input bg-background px-2.5 py-1.5 text-xs"
                    />
                    <button
                      type="submit"
                      className="rounded bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground"
                    >
                      + Add Motion
                    </button>
                  </div>
                </form>

                <div className="mt-4 space-y-3" dir="rtl">
                  {motions.map((mot) => (
                    <div
                      key={mot.id}
                      className="rounded-lg border border-border bg-muted/25 p-3.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                          {mot.category}
                        </span>
                        {activeSession && (
                          <button
                            type="button"
                            onClick={() =>
                              actions.updateSession(activeSession.id, {
                                motion: mot.motion,
                                info_slide: mot.info_slide,
                              })
                            }
                            className="rounded border border-border bg-card px-2.5 py-1 text-[11px] font-semibold hover:bg-muted"
                          >
                            Use in Active Practice
                          </button>
                        )}
                      </div>
                      {mot.info_slide && (
                        <p className="mt-2 rounded bg-background p-2 text-xs text-muted-foreground">
                          <strong>Info Slide:</strong> {mot.info_slide}
                        </p>
                      )}
                      <p className="mt-2 text-sm font-bold text-foreground">{mot.motion}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Announcements Manager */}
            <div className="space-y-4 lg:col-span-5">
              <div className="rounded-xl border border-border bg-card p-5 shadow-2xs">
                <h2 className="text-base font-bold text-foreground">Post Club Announcement</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!newAnnTitle.trim() || !newAnnBody.trim()) return
                    actions.addAnnouncement({
                      title: newAnnTitle,
                      body: newAnnBody,
                      author_name: memberDisplayName(activeMember),
                      pinned: true,
                    })
                    setNewAnnTitle('')
                    setNewAnnBody('')
                  }}
                  className="mt-3 space-y-2.5"
                  dir="rtl"
                >
                  <input
                    type="text"
                    value={newAnnTitle}
                    onChange={(e) => setNewAnnTitle(e.target.value)}
                    placeholder="כותרת ההודעה..."
                    className="w-full rounded border border-input bg-background px-3 py-2 text-xs"
                  />
                  <textarea
                    rows={3}
                    value={newAnnBody}
                    onChange={(e) => setNewAnnBody(e.target.value)}
                    placeholder="תוכן ההודעה לכל חברי המועדון..."
                    className="w-full rounded border border-input bg-background p-3 text-xs"
                  />
                  <button
                    type="submit"
                    className="w-full rounded bg-primary px-4 py-2 text-xs font-bold text-primary-foreground"
                  >
                    Publish Announcement
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Google SSO Join / Connect Modal */}
      {ssoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <h2 className="text-base font-bold text-foreground">
              Connect Member via Google SSO
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Simulates or registers a club member signing in with their Google account and adds them directly to the database & active training.
            </p>
            <form onSubmit={handleGoogleSsoSubmit} className="mt-4 space-y-3">
              <input
                type="email"
                required
                value={ssoEmail}
                onChange={(e) => setSsoEmail(e.target.value)}
                placeholder="student@runi.ac.il or gmail.com"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
              />
              <input
                type="text"
                dir="rtl"
                value={ssoNameHeb}
                onChange={(e) => setSsoNameHeb(e.target.value)}
                placeholder="שם מלא בעברית (למשל: יעל ברק)"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
              />
              <input
                type="text"
                value={ssoNameEng}
                onChange={(e) => setSsoNameEng(e.target.value)}
                placeholder="Full Name in English (e.g., Yael Barak)"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
              />
              <input
                type="text"
                dir="rtl"
                value={ssoTrack}
                onChange={(e) => setSsoTrack(e.target.value)}
                placeholder="מסלול לימודים (למשל: משפטים וממשל)"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSsoModalOpen(false)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground"
                >
                  Sign In with Google & Check In
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Plan New Training Session Modal */}
      {newSessionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <h2 className="text-base font-bold text-foreground">Plan New Training Session</h2>
            <form onSubmit={handleCreateSession} className="mt-4 space-y-3">
              <input
                type="text"
                required
                dir="rtl"
                value={newSessionTitle}
                onChange={(e) => setNewSessionTitle(e.target.value)}
                placeholder="שם האימון (למשל: אימון שני — סדנת פריימינג)"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
              />
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="date"
                  value={newSessionDate}
                  onChange={(e) => setNewSessionDate(e.target.value)}
                  className="rounded-md border border-input bg-background px-2.5 py-2 text-xs"
                />
                <input
                  type="time"
                  value={newSessionTime}
                  onChange={(e) => setNewSessionTime(e.target.value)}
                  className="rounded-md border border-input bg-background px-2.5 py-2 text-xs"
                />
                <select
                  value={newSessionType}
                  onChange={(e) =>
                    setNewSessionType(
                      e.target.value as 'Practice' | 'Lesson' | 'Tournament Prep',
                    )
                  }
                  className="rounded-md border border-input bg-background px-2 py-2 text-xs"
                >
                  <option value="Practice">Practice</option>
                  <option value="Lesson">Lesson</option>
                  <option value="Tournament Prep">Tournament Prep</option>
                </select>
              </div>
              <textarea
                rows={2}
                dir="rtl"
                value={newSessionMotion}
                onChange={(e) => setNewSessionMotion(e.target.value)}
                placeholder="מושן האימון (אופציונלי)..."
                className="w-full rounded-md border border-input bg-background p-2.5 text-xs"
              />
              <textarea
                rows={2}
                dir="rtl"
                value={newSessionInfoSlide}
                onChange={(e) => setNewSessionInfoSlide(e.target.value)}
                placeholder="שקופית מידע (אופציונלי)..."
                className="w-full rounded-md border border-input bg-background p-2.5 text-xs"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewSessionOpen(false)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground"
                >
                  Create Training Session
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
