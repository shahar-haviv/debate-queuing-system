/**
 * Persistence and real-time sync service for the Club Training module
 * (`src/training/services/trainingStorage.ts`).
 */
import { todayIso } from '../../domain/events'
import { generateSmartRoomDraw } from '../domain/pairingEngine'
import type {
  LanguagePreference,
  MemberPermission,
  PairingOptions,
  RegistrationStatus,
  RolePreference,
  TrainingDrawState,
  TrainingMember,
  TrainingRegistration,
  TrainingResult,
  TrainingSession,
} from '../types'

const STORAGE_KEY = 'cq:trainingStore:v2'
const CHANNEL_NAME = 'cq:training-realtime'

export interface TrainingStoreData {
  members: TrainingMember[]
  sessions: TrainingSession[]
  registrations: TrainingRegistration[]
  results: TrainingResult[]
  activePersonaId: string
}

const listeners = new Set<() => void>()
let channel: BroadcastChannel | null = null
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  try {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = () => {
      listeners.forEach((fn) => fn())
    }
  } catch {
    channel = null
  }
}

function notifyListeners(): void {
  listeners.forEach((fn) => fn())
  try {
    channel?.postMessage({ updatedAt: Date.now() })
  } catch {
    // ignore channel errors
  }
}

export function subscribeTrainingStore(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function createSeedTrainingStore(): TrainingStoreData {
  const today = todayIso()
  const nowIso = new Date().toISOString()

  const members: TrainingMember[] = [
    {
      id: 'mem-admin',
      email: 'idc.debate@gmail.com',
      full_name_heb: 'שחר חביב',
      full_name_eng: 'Shahar Haviv',
      phone_number: '050-1110000',
      gender: 'Male',
      club: 'IDC Debate',
      start_year: 2023,
      student_track: 'מדעי המחשב ויזמות',
      rank: 'Senior',
      official_judgement_level: 'CA',
      permissions: 'Admin',
      email_subscribed: true,
      extra_info: 'Club Admin',
      created_at: nowIso,
    },
    {
      id: 'mem-sr-1',
      email: 'romi.cohen@runi.ac.il',
      full_name_heb: 'רומי כהן',
      full_name_eng: 'Romi Cohen',
      phone_number: '050-7778899',
      gender: 'Female',
      club: 'IDC Debate',
      start_year: 2024,
      student_track: 'משפטים וממשל',
      rank: 'Senior',
      official_judgement_level: 'Chair',
      permissions: 'Manager',
      email_subscribed: true,
      extra_info: 'VP Training',
      created_at: nowIso,
    },
    {
      id: 'mem-sr-2',
      email: 'daniel.levi@runi.ac.il',
      full_name_heb: 'דניאל לוי',
      full_name_eng: 'Daniel Levi',
      phone_number: '050-1112233',
      gender: 'Male',
      club: 'IDC Debate',
      start_year: 2024,
      student_track: 'כלכלה ומנהל עסקים',
      rank: 'Senior',
      official_judgement_level: 'Chair',
      permissions: 'Manager',
      email_subscribed: true,
      extra_info: 'Senior Chair',
      created_at: nowIso,
    },
    {
      id: 'mem-sr-3',
      email: 'noa.shapira@runi.ac.il',
      full_name_heb: 'נועה שפירא',
      full_name_eng: 'Noa Shapira',
      phone_number: '052-3334455',
      gender: 'Female',
      club: 'IDC Debate',
      start_year: 2025,
      student_track: 'פסיכולוגיה',
      rank: 'Senior',
      official_judgement_level: 'Chair',
      permissions: 'Student',
      email_subscribed: true,
      extra_info: '',
      created_at: nowIso,
    },
    {
      id: 'mem-sr-4',
      email: 'omer.katz@runi.ac.il',
      full_name_heb: 'עומר כץ',
      full_name_eng: 'Omer Katz',
      phone_number: '054-5556677',
      gender: 'Male',
      club: 'IDC Debate',
      start_year: 2025,
      student_track: 'ממשל ואסטרטגיה',
      rank: 'Senior',
      official_judgement_level: 'Wing',
      permissions: 'Student',
      email_subscribed: true,
      extra_info: '',
      created_at: nowIso,
    },
    {
      id: 'mem-jr-1',
      email: 'tomer.segev@runi.ac.il',
      full_name_heb: 'תומר שגב',
      full_name_eng: 'Tomer Segev',
      phone_number: '054-7890123',
      gender: 'Male',
      club: 'IDC Debate',
      start_year: 2026,
      student_track: 'משפטים וממשל',
      rank: 'Junior',
      official_judgement_level: 'Wing',
      permissions: 'Student',
      email_subscribed: true,
      extra_info: 'Year 1',
      created_at: nowIso,
    },
    {
      id: 'mem-jr-2',
      email: 'dana.levi@runi.ac.il',
      full_name_heb: 'דנה לוי',
      full_name_eng: 'Dana Levi',
      phone_number: '052-2345678',
      gender: 'Female',
      club: 'IDC Debate',
      start_year: 2026,
      student_track: 'מדעי המחשב',
      rank: 'Junior',
      official_judgement_level: 'Wing',
      permissions: 'Student',
      email_subscribed: true,
      extra_info: 'Year 1',
      created_at: nowIso,
    },
    {
      id: 'mem-jr-3',
      email: 'amit.friedman@runi.ac.il',
      full_name_heb: 'עמית פרידמן',
      full_name_eng: 'Amit Friedman',
      phone_number: '054-3456789',
      gender: 'Male',
      club: 'IDC Debate',
      start_year: 2026,
      student_track: 'כלכלה וקיימות',
      rank: 'Junior',
      official_judgement_level: 'Wing',
      permissions: 'Student',
      email_subscribed: true,
      extra_info: 'Year 1',
      created_at: nowIso,
    },
    {
      id: 'mem-jr-4',
      email: 'shira.abraham@runi.ac.il',
      full_name_heb: 'שירה אברהם',
      full_name_eng: 'Shira Abraham',
      phone_number: '053-4567890',
      gender: 'Female',
      club: 'IDC Debate',
      start_year: 2026,
      student_track: 'תקשורת',
      rank: 'Junior',
      official_judgement_level: 'Wing',
      permissions: 'Student',
      email_subscribed: true,
      extra_info: 'Year 1',
      created_at: nowIso,
    },
    {
      id: 'mem-jr-5',
      email: 'yossi.cohen@runi.ac.il',
      full_name_heb: 'יוסי כהן',
      full_name_eng: 'Yossi Cohen',
      phone_number: '050-1234567',
      gender: 'Male',
      club: 'IDC Debate',
      start_year: 2026,
      student_track: 'מנהל עסקים',
      rank: 'Junior',
      official_judgement_level: 'Wing',
      permissions: 'Student',
      email_subscribed: true,
      extra_info: 'Year 1',
      created_at: nowIso,
    },
    {
      id: 'mem-jr-6',
      email: 'maya.golan@runi.ac.il',
      full_name_heb: 'מאיה גולן',
      full_name_eng: 'Maya Golan',
      phone_number: '052-6789012',
      gender: 'Female',
      club: 'IDC Debate',
      start_year: 2026,
      student_track: 'משפטים',
      rank: 'Junior',
      official_judgement_level: 'Wing',
      permissions: 'Student',
      email_subscribed: true,
      extra_info: 'Year 1',
      created_at: nowIso,
    },
    {
      id: 'mem-pending-1',
      email: 'itay.rosenberg@gmail.com',
      full_name_heb: 'איתי רוזנברג',
      full_name_eng: 'Itay Rosenberg',
      phone_number: '050-5678901',
      gender: 'Male',
      club: 'IDC Debate',
      start_year: 2026,
      student_track: 'מדעי המחשב',
      rank: 'Junior',
      official_judgement_level: 'Wing',
      permissions: 'Pending',
      email_subscribed: true,
      extra_info: 'Joined via Google SSO',
      created_at: nowIso,
    },
  ]

  const results: TrainingResult[] = [
    {
      id: 'res-1',
      session_id: 'sess-past-1',
      session_date: '2026-10-26',
      room_name: 'A206',
      member_id: 'mem-jr-1',
      partner_id: 'mem-jr-2',
      chair_id: 'mem-sr-1',
      position: 'Opening Government',
      team_rank: 1,
      speaker_points: 77,
      positive_feedback: 'Strong opening mechanism and structure.',
      improvement_feedback: 'Engage earlier with the counter-model.',
      created_at: '2026-10-26T20:30:00Z',
    },
    {
      id: 'res-2',
      session_id: 'sess-past-1',
      session_date: '2026-10-26',
      room_name: 'A206',
      member_id: 'mem-jr-2',
      partner_id: 'mem-jr-1',
      chair_id: 'mem-sr-1',
      position: 'Opening Government',
      team_rank: 1,
      speaker_points: 76.5,
      positive_feedback: 'Direct rebuttal to OO.',
      improvement_feedback: 'Sharpen long-term impact weighing.',
      created_at: '2026-10-26T20:30:00Z',
    },
    {
      id: 'res-3',
      session_id: 'sess-past-1',
      session_date: '2026-10-26',
      room_name: 'A206',
      member_id: 'mem-jr-3',
      partner_id: 'mem-jr-4',
      chair_id: 'mem-sr-1',
      position: 'Opening Opposition',
      team_rank: 2,
      speaker_points: 75.5,
      positive_feedback: 'Clear incentive analysis.',
      improvement_feedback: 'Take a POI from Closing.',
      created_at: '2026-10-26T20:30:00Z',
    },
    {
      id: 'res-4',
      session_id: 'sess-past-1',
      session_date: '2026-10-26',
      room_name: 'A206',
      member_id: 'mem-jr-4',
      partner_id: 'mem-jr-3',
      chair_id: 'mem-sr-1',
      position: 'Opening Opposition',
      team_rank: 2,
      speaker_points: 75,
      positive_feedback: 'Coherent case split.',
      improvement_feedback: 'Weigh principle vs practical harm.',
      created_at: '2026-10-26T20:30:00Z',
    },
    {
      id: 'res-5',
      session_id: 'sess-past-1',
      session_date: '2026-10-26',
      room_name: 'A206',
      member_id: 'mem-jr-5',
      partner_id: 'mem-jr-6',
      chair_id: 'mem-sr-1',
      position: 'Closing Government',
      team_rank: 3,
      speaker_points: 74,
      positive_feedback: 'Good extension angle.',
      improvement_feedback: 'Differentiate extension from OG earlier.',
      created_at: '2026-10-26T20:30:00Z',
    },
    {
      id: 'res-6',
      session_id: 'sess-past-1',
      session_date: '2026-10-26',
      room_name: 'A206',
      member_id: 'mem-jr-6',
      partner_id: 'mem-jr-5',
      chair_id: 'mem-sr-1',
      position: 'Closing Government',
      team_rank: 3,
      speaker_points: 74.5,
      positive_feedback: 'Structured whip speech by clash points.',
      improvement_feedback: 'Prioritize OO comparison before OG.',
      created_at: '2026-10-26T20:30:00Z',
    },
    {
      id: 'res-7',
      session_id: 'sess-past-1',
      session_date: '2026-10-26',
      room_name: 'A206',
      member_id: 'mem-sr-3',
      partner_id: 'mem-sr-4',
      chair_id: 'mem-sr-1',
      position: 'Closing Opposition',
      team_rank: 4,
      speaker_points: 78,
      positive_feedback: 'Great framing demonstration.',
      improvement_feedback: '',
      created_at: '2026-10-26T20:30:00Z',
    },
    {
      id: 'res-8',
      session_id: 'sess-past-1',
      session_date: '2026-10-26',
      room_name: 'A206',
      member_id: 'mem-sr-1',
      partner_id: null,
      chair_id: null,
      position: 'Chair',
      team_rank: null,
      speaker_points: null,
      positive_feedback: '',
      improvement_feedback: '',
      created_at: '2026-10-26T20:30:00Z',
    },
  ]

  const activeSessionId = 'sess-active-1'
  const registrations: TrainingRegistration[] = [
    {
      id: 'reg-1',
      session_id: activeSessionId,
      member_id: 'mem-sr-1',
      status: 'CheckedIn',
      role_preference: 'Judge',
      language_preference: 'Hebrew',
      partner_id: null,
      notes: '',
      checked_in_at: nowIso,
      created_at: nowIso,
    },
    {
      id: 'reg-2',
      session_id: activeSessionId,
      member_id: 'mem-sr-2',
      status: 'CheckedIn',
      role_preference: 'Judge',
      language_preference: 'Hebrew',
      partner_id: null,
      notes: '',
      checked_in_at: nowIso,
      created_at: nowIso,
    },
    {
      id: 'reg-3',
      session_id: activeSessionId,
      member_id: 'mem-sr-3',
      status: 'CheckedIn',
      role_preference: 'Debate',
      language_preference: 'Hebrew',
      partner_id: null,
      notes: '',
      checked_in_at: nowIso,
      created_at: nowIso,
    },
    {
      id: 'reg-4',
      session_id: activeSessionId,
      member_id: 'mem-sr-4',
      status: 'CheckedIn',
      role_preference: 'Debate',
      language_preference: 'Hebrew',
      partner_id: null,
      notes: '',
      checked_in_at: nowIso,
      created_at: nowIso,
    },
    {
      id: 'reg-5',
      session_id: activeSessionId,
      member_id: 'mem-jr-1',
      status: 'CheckedIn',
      role_preference: 'Debate',
      language_preference: 'Hebrew',
      partner_id: 'mem-jr-3',
      notes: '',
      checked_in_at: nowIso,
      created_at: nowIso,
    },
    {
      id: 'reg-6',
      session_id: activeSessionId,
      member_id: 'mem-jr-2',
      status: 'CheckedIn',
      role_preference: 'Debate',
      language_preference: 'Hebrew',
      partner_id: null,
      notes: '',
      checked_in_at: nowIso,
      created_at: nowIso,
    },
    {
      id: 'reg-7',
      session_id: activeSessionId,
      member_id: 'mem-jr-3',
      status: 'CheckedIn',
      role_preference: 'Debate',
      language_preference: 'Hebrew',
      partner_id: 'mem-jr-1',
      notes: '',
      checked_in_at: nowIso,
      created_at: nowIso,
    },
    {
      id: 'reg-8',
      session_id: activeSessionId,
      member_id: 'mem-jr-4',
      status: 'CheckedIn',
      role_preference: 'Debate',
      language_preference: 'Hebrew',
      partner_id: null,
      notes: '',
      checked_in_at: nowIso,
      created_at: nowIso,
    },
    {
      id: 'reg-9',
      session_id: activeSessionId,
      member_id: 'mem-jr-5',
      status: 'CheckedIn',
      role_preference: 'Debate',
      language_preference: 'Hebrew',
      partner_id: null,
      notes: '',
      checked_in_at: nowIso,
      created_at: nowIso,
    },
    {
      id: 'reg-10',
      session_id: activeSessionId,
      member_id: 'mem-jr-6',
      status: 'Registered',
      role_preference: 'Debate',
      language_preference: 'Hebrew',
      partner_id: null,
      notes: '',
      checked_in_at: null,
      created_at: nowIso,
    },
    // Registrations for the second planned training this week
    {
      id: 'reg-11',
      session_id: 'sess-upcoming-2',
      member_id: 'mem-sr-1',
      status: 'Registered',
      role_preference: 'Judge',
      language_preference: 'English',
      partner_id: null,
      notes: '',
      checked_in_at: null,
      created_at: nowIso,
    },
    {
      id: 'reg-12',
      session_id: 'sess-upcoming-2',
      member_id: 'mem-jr-1',
      status: 'Registered',
      role_preference: 'Debate',
      language_preference: 'English',
      partner_id: null,
      notes: '',
      checked_in_at: null,
      created_at: nowIso,
    },
    {
      id: 'reg-13',
      session_id: 'sess-upcoming-2',
      member_id: 'mem-jr-2',
      status: 'Registered',
      role_preference: 'Debate',
      language_preference: 'English',
      partner_id: null,
      notes: '',
      checked_in_at: null,
      created_at: nowIso,
    },
    {
      id: 'reg-14',
      session_id: 'sess-upcoming-2',
      member_id: 'mem-jr-4',
      status: 'Registered',
      role_preference: 'Debate',
      language_preference: 'English',
      partner_id: null,
      notes: '',
      checked_in_at: null,
      created_at: nowIso,
    },
  ]

  const initialDraw = generateSmartRoomDraw(
    members,
    registrations.filter((r) => r.session_id === activeSessionId),
    results,
  )

  const sessions: TrainingSession[] = [
    {
      id: activeSessionId,
      title: 'Monday Club Practice',
      date: today,
      time: '18:30',
      event_type: 'Practice',
      status: 'Check-In',
      notes: 'Room A206',
      draw: initialDraw,
      created_at: nowIso,
    },
    {
      id: 'sess-upcoming-2',
      title: 'Wednesday English Practice',
      date: '2026-11-11',
      time: '19:00',
      event_type: 'Practice',
      status: 'Upcoming',
      notes: 'Room A206',
      draw: {
        rooms: [],
        waitlist: [],
        trash: [],
        strategy: 'balanced-history',
      },
      created_at: nowIso,
    },
    {
      id: 'sess-upcoming-3',
      title: 'Thursday Juniors Workshop',
      date: '2026-11-12',
      time: '18:00',
      event_type: 'Lesson',
      status: 'Upcoming',
      notes: 'Room A208',
      draw: {
        rooms: [],
        waitlist: [],
        trash: [],
        strategy: 'pro-am',
      },
      created_at: nowIso,
    },
  ]

  return {
    members,
    sessions,
    registrations,
    results,
    activePersonaId: 'mem-admin',
  }
}

export function loadTrainingStore(): TrainingStoreData {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return createSeedTrainingStore()
    }
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const seed = createSeedTrainingStore()
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed))
      return seed
    }
    return JSON.parse(raw) as TrainingStoreData
  } catch {
    return createSeedTrainingStore()
  }
}

export function saveTrainingStore(store: TrainingStoreData): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    }
  } catch {
    // ignore storage errors
  }
  notifyListeners()
}

export function resetTrainingStore(): TrainingStoreData {
  const seed = createSeedTrainingStore()
  saveTrainingStore(seed)
  return seed
}

export const trainingService = {
  getStore(): TrainingStoreData {
    return loadTrainingStore()
  },

  upsertRegistration(input: {
    sessionId: string
    memberId: string
    status?: RegistrationStatus
    rolePreference: RolePreference
    languagePreference: LanguagePreference
    partnerId?: string | null
    notes?: string
  }): TrainingRegistration {
    const store = loadTrainingStore()
    const idx = store.registrations.findIndex(
      (r) => r.session_id === input.sessionId && r.member_id === input.memberId,
    )
    const nowIso = new Date().toISOString()

    if (idx >= 0) {
      const prev = store.registrations[idx]
      const nextStatus = input.status ?? prev.status
      const updated: TrainingRegistration = {
        ...prev,
        status: nextStatus,
        role_preference: input.rolePreference,
        language_preference: input.languagePreference,
        partner_id: input.partnerId !== undefined ? input.partnerId : prev.partner_id,
        notes: input.notes !== undefined ? input.notes : prev.notes,
        checked_in_at:
          nextStatus === 'CheckedIn' ? prev.checked_in_at ?? nowIso : null,
      }
      store.registrations[idx] = updated
      saveTrainingStore(store)
      return updated
    }

    const status = input.status ?? 'Registered'
    const created: TrainingRegistration = {
      id: `reg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      session_id: input.sessionId,
      member_id: input.memberId,
      status,
      role_preference: input.rolePreference,
      language_preference: input.languagePreference,
      partner_id: input.partnerId ?? null,
      notes: input.notes ?? '',
      checked_in_at: status === 'CheckedIn' ? nowIso : null,
      created_at: nowIso,
    }
    store.registrations.push(created)
    saveTrainingStore(store)
    return created
  },

  toggleCheckIn(sessionId: string, memberId: string): TrainingRegistration {
    const store = loadTrainingStore()
    const existing = store.registrations.find(
      (r) => r.session_id === sessionId && r.member_id === memberId,
    )
    const nextStatus: RegistrationStatus =
      existing?.status === 'CheckedIn' ? 'Registered' : 'CheckedIn'
    return trainingService.upsertRegistration({
      sessionId,
      memberId,
      status: nextStatus,
      rolePreference: existing?.role_preference ?? 'Debate',
      languagePreference: existing?.language_preference ?? 'Hebrew',
      partnerId: existing?.partner_id ?? null,
      notes: existing?.notes ?? '',
    })
  },

  cancelRegistration(sessionId: string, memberId: string): void {
    const store = loadTrainingStore()
    const idx = store.registrations.findIndex(
      (r) => r.session_id === sessionId && r.member_id === memberId,
    )
    if (idx >= 0) {
      store.registrations[idx].status = 'Cancelled'
      store.registrations[idx].checked_in_at = null
      saveTrainingStore(store)
    }
  },

  createSession(input: {
    title: string
    date: string
    time: string
    event_type: TrainingSession['event_type']
    notes?: string
    expectedMemberIds?: string[]
  }): TrainingSession {
    const store = loadTrainingStore()
    const nowIso = new Date().toISOString()
    const created: TrainingSession = {
      id: `sess-${Date.now()}`,
      title: input.title.trim(),
      date: input.date,
      time: input.time || '18:30',
      event_type: input.event_type,
      status: 'Upcoming',
      notes: input.notes?.trim() ?? '',
      draw: {
        rooms: [],
        waitlist: [],
        trash: [],
        strategy: 'balanced-history',
      },
      created_at: nowIso,
    }
    store.sessions.unshift(created)

    if (input.expectedMemberIds && input.expectedMemberIds.length > 0) {
      for (const memberId of input.expectedMemberIds) {
        const member = store.members.find((m) => m.id === memberId)
        if (!member) continue
        store.registrations.push({
          id: `reg-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          session_id: created.id,
          member_id: member.id,
          status: 'Registered',
          role_preference: member.official_judgement_level === 'Chair' ? 'Judge' : 'Debate',
          language_preference: 'Hebrew',
          partner_id: null,
          notes: '',
          checked_in_at: null,
          created_at: nowIso,
        })
      }
    }

    saveTrainingStore(store)
    return created
  },

  updateSession(
    sessionId: string,
    patch: Partial<
      Pick<
        TrainingSession,
        'title' | 'date' | 'time' | 'event_type' | 'status' | 'notes' | 'draw'
      >
    >,
  ): TrainingSession {
    const store = loadTrainingStore()
    const idx = store.sessions.findIndex((s) => s.id === sessionId)
    if (idx < 0) throw new Error('Training session not found.')
    const updated: TrainingSession = {
      ...store.sessions[idx],
      ...patch,
    }
    store.sessions[idx] = updated
    saveTrainingStore(store)
    return updated
  },

  runSmartAutoFill(sessionId: string, options: PairingOptions): TrainingDrawState {
    const store = loadTrainingStore()
    const session = store.sessions.find((s) => s.id === sessionId)
    if (!session) throw new Error('Training session not found.')
    const sessionRegs = store.registrations.filter((r) => r.session_id === sessionId)
    const existingNames = session.draw.rooms.map((r) => r.room_name)

    const draw = generateSmartRoomDraw(
      store.members,
      sessionRegs,
      store.results,
      options,
      existingNames,
    )
    session.draw = draw
    saveTrainingStore(store)
    return draw
  },

  recordResult(input: Omit<TrainingResult, 'id' | 'created_at'>): TrainingResult {
    const store = loadTrainingStore()
    const created: TrainingResult = {
      ...input,
      id: `res-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      created_at: new Date().toISOString(),
    }
    store.results.unshift(created)
    saveTrainingStore(store)
    return created
  },

  updateMember(
    memberId: string,
    patch: Partial<
      Pick<
        TrainingMember,
        | 'full_name_heb'
        | 'full_name_eng'
        | 'phone_number'
        | 'rank'
        | 'official_judgement_level'
        | 'permissions'
        | 'student_track'
        | 'extra_info'
      >
    >,
  ): TrainingMember {
    const store = loadTrainingStore()
    const idx = store.members.findIndex((m) => m.id === memberId)
    if (idx < 0) throw new Error('Member not found.')
    store.members[idx] = { ...store.members[idx], ...patch }
    saveTrainingStore(store)
    return store.members[idx]
  },

  approvePendingMember(memberId: string, permission: MemberPermission = 'Student'): TrainingMember {
    return trainingService.updateMember(memberId, { permissions: permission })
  },
}
