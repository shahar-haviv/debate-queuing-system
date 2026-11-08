/**
 * Persistence and real-time sync service for the Club Training module
 * (`src/training/services/trainingStorage.ts`).
 *
 * Works seamlessly in both Local Sandbox mode (`localStorage` + `BroadcastChannel`)
 * and Supabase mode (falling back gracefully if the training tables have not yet
 * been pushed via `bun run db:push`).
 */
import { todayIso } from '../../domain/events'
import { generateSmartRoomDraw } from '../domain/pairingEngine'
import type {
  LanguagePreference,
  MemberPermission,
  PairingOptions,
  RegistrationStatus,
  RolePreference,
  TrainingAnnouncement,
  TrainingDrawState,
  TrainingMember,
  TrainingMotion,
  TrainingRegistration,
  TrainingResult,
  TrainingSession,
} from '../types'

const STORAGE_KEY = 'cq:trainingStore:v1'
const CHANNEL_NAME = 'cq:training-realtime'

export interface TrainingStoreData {
  members: TrainingMember[]
  sessions: TrainingSession[]
  registrations: TrainingRegistration[]
  results: TrainingResult[]
  motions: TrainingMotion[]
  announcements: TrainingAnnouncement[]
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
      full_name_heb: 'שחר חביב (הנהלת המועדון)',
      full_name_eng: 'Shahar Haviv (IDC Admin)',
      phone_number: '050-1110000',
      gender: 'Male',
      club: 'IDC Debate',
      start_year: 2023,
      student_track: 'מדעי המחשב ויזמות',
      rank: 'Senior',
      official_judgement_level: 'CA',
      permissions: 'Admin',
      email_subscribed: true,
      extra_info: 'Chief Adjudicator & Club Admin',
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
      extra_info: 'VP Training & Senior Chair',
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
      extra_info: 'Senior Debater & Chair',
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
      extra_info: 'EUDC Quarterfinalist',
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
      extra_info: 'שנה א׳ — מחזור 2026',
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
      extra_info: 'שנה א׳ — מחזור 2026',
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
      extra_info: 'שנה א׳ — מחזור 2026',
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
      extra_info: 'שנה א׳ — מחזור 2026',
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
      extra_info: 'שנה א׳ — מחזור 2026',
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
      extra_info: 'שנה א׳ — מחזור 2026',
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
      extra_info: 'Signed in via Google SSO — awaiting board approval',
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
      motion: 'ב״ז יאסור על חברות טכנולוגיה להשתמש באלגוריתמים ממכרים לבני נוער',
      info_slide: '',
      positive_feedback: 'פתיחה מבנית מעולה, הגדרת מנגנון ברורה של הפגיעה בקשב.',
      improvement_feedback: 'להקדיש יותר זמן להשוואת החלופה של רגולציה עצמית של ההורים.',
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
      motion: 'ב״ז יאסור על חברות טכנולוגיה להשתמש באלגוריתמים ממכרים לבני נוער',
      info_slide: '',
      positive_feedback: 'ריבטל מדויק לטענת חופש העיסוק של האופוזיציה הפותחת.',
      improvement_feedback: 'לחדד את האימפקט הפסיכולוגי בטווח הארוך.',
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
      motion: 'ב״ז יאסור על חברות טכנולוגיה להשתמש באלגוריתמים ממכרים לבני נוער',
      info_slide: '',
      positive_feedback: 'ניתוח מצוין של תמריצי השוק השחור והקושי באכיפה.',
      improvement_feedback: 'להיכנס מוקדם יותר מול הטיעון העקרוני של ממשלה פותחת.',
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
      motion: 'ב״ז יאסור על חברות טכנולוגיה להשתמש באלגוריתמים ממכרים לבני נוער',
      info_slide: '',
      positive_feedback: 'בניית קייס קוהרנטית ומענה טוב ל-POI.',
      improvement_feedback: 'לשקלל את הנזק מול התועלת של נגישות מידע.',
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
      motion: 'ב״ז יאסור על חברות טכנולוגיה להשתמש באלגוריתמים ממכרים לבני נוער',
      info_slide: '',
      positive_feedback: 'הרחבה מעניינת על פגיעה בדמוקרטיה וקיטוב.',
      improvement_feedback: 'לוודא שההרחבה מובחנת בבירור ממה שעלה ב-OG.',
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
      motion: 'ב״ז יאסור על חברות טכנולוגיה להשתמש באלגוריתמים ממכרים לבני נוער',
      info_slide: '',
      positive_feedback: 'סיכום מסודר מאוד לפי נקודות התנגשות.',
      improvement_feedback: 'לתעדף את ההשוואה מול OO לפני ההשוואה מול OG.',
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
      motion: 'ב״ז יאסור על חברות טכנולוגיה להשתמש באלגוריתמים ממכרים לבני נוער',
      info_slide: '',
      positive_feedback: 'הדגמה מצוינת של פריימינג וניתוח שחקנים לשנה א׳.',
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
      motion: 'ב״ז יאסור על חברות טכנולוגיה להשתמש באלגוריתמים ממכרים לבני נוער',
      info_slide: '',
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
      notes: 'Chairing Room 1',
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
      notes: 'Available to Chair or Wing',
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
      notes: 'Happy to Pro-Am with a Junior',
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
      notes: 'Requested Amit Friedman as partner',
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
      notes: 'Requested Tomer Segev as partner',
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
      notes: 'On the way — arriving 18:35',
      checked_in_at: null,
      created_at: nowIso,
    },
  ]

  const initialDraw = generateSmartRoomDraw(members, registrations, results)

  const sessions: TrainingSession[] = [
    {
      id: activeSessionId,
      title: 'אימון מועדון מרכזי — סדנת הרחבות ובית סוגר (BP Practice)',
      date: today,
      time: '18:30',
      event_type: 'Practice',
      status: 'Check-In',
      motion: 'ב״ז יחייב חברות בינה מלאכותית לשלם תמלוגים ליוצרים אנושיים שעל יצירותיהם אומנו המודלים',
      info_slide:
        'מודלים של בינה מלאכותית יוצרת (Generative AI) מאומנים על מיליארדי טקסטים, תמונות וקטעי קוד מהאינטרנט ללא הסכמה מפורשת או פיצוי ליוצרים המקוריים.',
      motion_visible: true,
      notes: '18:30 התכנסות וצ׳ק-אין בבניין אדלסון (A206) • 18:45 פרסום הגרלה ומושן • 19:00 תחילת דיבייט.',
      draw: initialDraw,
      created_at: nowIso,
    },
    {
      id: 'sess-upcoming-2',
      title: 'אימון חמישי באנגלית — International BP Prep',
      date: '2026-11-12',
      time: '18:00',
      event_type: 'Tournament Prep',
      status: 'Upcoming',
      motion: 'THBT developing nations should prioritize sovereign state-owned green energy over foreign private green investment',
      info_slide: '',
      motion_visible: false,
      notes: 'English practice round ahead of the Winter Pre-EUDC tournament.',
      draw: {
        rooms: [],
        waitlist: [],
        trash: [],
        strategy: 'skill-matched',
      },
      created_at: nowIso,
    },
    {
      id: 'sess-past-1',
      title: 'אימון פתיחת סמסטר — יסודות המבנה הלוגי וריבטל',
      date: '2026-10-26',
      time: '18:30',
      event_type: 'Practice',
      status: 'Completed',
      motion: 'ב״ז יאסור על חברות טכנולוגיה להשתמש באלגוריתמים ממכרים לבני נוער',
      info_slide: '',
      motion_visible: true,
      notes: 'אימון פתיחה למחזור 2026.',
      draw: {
        rooms: [],
        waitlist: [],
        trash: [],
        strategy: 'balanced-history',
      },
      created_at: '2026-10-26T18:00:00Z',
    },
  ]

  const motions: TrainingMotion[] = [
    {
      id: 'mot-1',
      category: 'טכנולוגיה ורגולציה',
      motion: 'ב״ז יחייב חברות בינה מלאכותית לשלם תמלוגים ליוצרים אנושיים שעל יצירותיהם אומנו המודלים',
      info_slide:
        'מודלים של בינה מלאכותית יוצרת (Generative AI) מאומנים על מיליארדי טקסטים, תמונות וקטעי קוד מהאינטרנט ללא הסכמה מפורשת או פיצוי ליוצרים המקוריים.',
      used_on: today,
      created_at: nowIso,
    },
    {
      id: 'mot-2',
      category: 'כלכלה וחברה',
      motion: 'ב״ז יבטל את מוסד הירושה מעל תקרה של 5 מיליון ש״ח ויעביר את העודף לקרן הזדמנויות לאומית לצעירים',
      info_slide: '',
      used_on: null,
      created_at: nowIso,
    },
    {
      id: 'mot-3',
      category: 'יחסים בינלאומיים',
      motion: 'THBT developing nations should prioritize sovereign state-owned green energy over foreign private green investment',
      info_slide: '',
      used_on: null,
      created_at: nowIso,
    },
    {
      id: 'mot-4',
      category: 'משפט ודמוקרטיה',
      motion: 'ב״ז יחליף ועדות מינוי שופטים בהגרלה אנונימית מתוך מאגר משפטנים שעמדו בבחינת כשירות אובייקטיבית',
      info_slide: '',
      used_on: null,
      created_at: nowIso,
    },
  ]

  const announcements: TrainingAnnouncement[] = [
    {
      id: 'ann-1',
      title: 'ברוכים הבאים למערכת האימונים החדשה של מועדון הדיבייט!',
      body: 'החל מהשבוע, ההרשמה לאימונים, הצ׳ק-אין בכניסה לחדר, בחירת העדפה (דיבייטר / שופט / בן זוג) והגרלת החדרים החכמה מתבצעים כאן. שימו לב לסמן הגעה (Check-In) ברגע שאתם מגיעים לקמפוס.',
      author_name: 'שחר חביב ורומי כהן',
      pinned: true,
      created_at: nowIso,
    },
    {
      id: 'ann-2',
      title: 'הרשמה לטורניר שנות א׳ הארצי נפתחה',
      body: 'מתמודדי שנה א׳ (Juniors) מוזמנים להירשם לאימוני ההכנה בימי שני וחמישי. האלגוריתם החדש מוודא שכל ג׳וניור מתנסה בכל 4 העמדות (OG, OO, CG, CO) ומקבל משוב משופטים מגוונים.',
      author_name: 'הנהלת המועדון',
      pinned: false,
      created_at: nowIso,
    },
  ]

  return {
    members,
    sessions,
    registrations,
    results,
    motions,
    announcements,
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

  setActivePersona(memberId: string): void {
    const store = loadTrainingStore()
    if (store.members.some((m) => m.id === memberId)) {
      store.activePersonaId = memberId
      saveTrainingStore(store)
    }
  },

  /**
   * Simulate or sync a Google SSO login: if the email is already in `members`,
   * switches to that member; otherwise creates a new `Junior` member (or `Admin`
   * for `idc.debate@gmail.com`) and returns it.
   */
  signInOrRegisterGoogleMember(input: {
    email: string
    fullNameHeb?: string
    fullNameEng?: string
    studentTrack?: string
  }): TrainingMember {
    const store = loadTrainingStore()
    const cleanEmail = input.email.trim().toLowerCase()
    const existing = store.members.find((m) => m.email.toLowerCase() === cleanEmail)
    if (existing) {
      store.activePersonaId = existing.id
      saveTrainingStore(store)
      return existing
    }

    const isAdminEmail = cleanEmail === 'idc.debate@gmail.com'
    const created: TrainingMember = {
      id: `mem-${Date.now()}`,
      email: cleanEmail,
      full_name_heb: input.fullNameHeb?.trim() || input.fullNameEng?.trim() || cleanEmail.split('@')[0],
      full_name_eng: input.fullNameEng?.trim() || input.fullNameHeb?.trim() || cleanEmail.split('@')[0],
      phone_number: '',
      gender: 'Prefer not to disclose',
      club: 'IDC Debate',
      start_year: new Date().getFullYear(),
      student_track: input.studentTrack?.trim() || '',
      rank: isAdminEmail ? 'Senior' : 'Junior',
      official_judgement_level: isAdminEmail ? 'CA' : 'Wing',
      permissions: isAdminEmail ? 'Admin' : 'Student',
      email_subscribed: true,
      extra_info: 'Joined via Google SSO',
      created_at: new Date().toISOString(),
    }
    store.members.push(created)
    store.activePersonaId = created.id
    saveTrainingStore(store)
    return created
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
    motion?: string
    info_slide?: string
    notes?: string
  }): TrainingSession {
    const store = loadTrainingStore()
    const created: TrainingSession = {
      id: `sess-${Date.now()}`,
      title: input.title.trim(),
      date: input.date,
      time: input.time || '18:30',
      event_type: input.event_type,
      status: 'Check-In',
      motion: input.motion?.trim() ?? '',
      info_slide: input.info_slide?.trim() ?? '',
      motion_visible: true,
      notes: input.notes?.trim() ?? '',
      draw: {
        rooms: [],
        waitlist: [],
        trash: [],
        strategy: 'balanced-history',
      },
      created_at: new Date().toISOString(),
    }
    store.sessions.unshift(created)
    saveTrainingStore(store)
    return created
  },

  updateSession(
    sessionId: string,
    patch: Partial<
      Pick<
        TrainingSession,
        'title' | 'date' | 'time' | 'event_type' | 'status' | 'motion' | 'info_slide' | 'motion_visible' | 'notes' | 'draw'
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

  promoteAllJuniorsToSeniors(): number {
    const store = loadTrainingStore()
    let count = 0
    for (const m of store.members) {
      if (m.rank === 'Junior' && m.permissions !== 'Pending') {
        m.rank = 'Senior'
        count++
      }
    }
    saveTrainingStore(store)
    return count
  },

  addMotion(input: { category: string; motion: string; info_slide?: string }): TrainingMotion {
    const store = loadTrainingStore()
    const created: TrainingMotion = {
      id: `mot-${Date.now()}`,
      category: input.category.trim() || 'כללי',
      motion: input.motion.trim(),
      info_slide: input.info_slide?.trim() ?? '',
      used_on: null,
      created_at: new Date().toISOString(),
    }
    store.motions.unshift(created)
    saveTrainingStore(store)
    return created
  },

  addAnnouncement(input: {
    title: string
    body: string
    author_name: string
    pinned?: boolean
  }): TrainingAnnouncement {
    const store = loadTrainingStore()
    const created: TrainingAnnouncement = {
      id: `ann-${Date.now()}`,
      title: input.title.trim(),
      body: input.body.trim(),
      author_name: input.author_name.trim() || 'הנהלת המועדון',
      pinned: Boolean(input.pinned),
      created_at: new Date().toISOString(),
    }
    store.announcements.unshift(created)
    saveTrainingStore(store)
    return created
  },
}
