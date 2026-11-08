/**
 * Domain types for the Club Training & Smart BP Room Draw module (`src/training/`).
 */

export type DebaterRank = 'Junior' | 'Senior'

export type MemberPermission = 'Pending' | 'Student' | 'Manager' | 'Admin'

export type RolePreference = 'Debate' | 'Judge' | 'No preference'

export type LanguagePreference = 'Hebrew' | 'English' | 'No preference'

export type RegistrationStatus = 'Registered' | 'CheckedIn' | 'Cancelled'

export type TrainingEventType = 'Practice' | 'Lesson' | 'Tournament Prep'

export type TrainingSessionStatus = 'Upcoming' | 'Check-In' | 'Draw Published' | 'Completed'

export type BpPosition =
  | 'Opening Government'
  | 'Opening Opposition'
  | 'Closing Government'
  | 'Closing Opposition'

export type RoomRole = BpPosition | 'Chair' | 'Panel'

export type PairingStrategy = 'balanced-history' | 'pro-am' | 'skill-matched' | 'random'

export interface TrainingMember {
  id: string
  email: string
  full_name_heb: string
  full_name_eng: string
  phone_number: string
  gender: 'Female' | 'Male' | 'Prefer not to disclose'
  club: string
  start_year: number
  student_track: string
  rank: DebaterRank
  official_judgement_level: 'Wing' | 'Chair' | 'CA'
  permissions: MemberPermission
  email_subscribed: boolean
  avatar_url?: string | null
  extra_info: string
  created_at: string
}

export interface TrainingRegistration {
  id: string
  session_id: string
  member_id: string
  status: RegistrationStatus
  role_preference: RolePreference
  language_preference: LanguagePreference
  partner_id: string | null
  notes: string
  checked_in_at: string | null
  created_at: string
}

export interface TrainingRoomDraw {
  id: string
  room_name: string
  language: 'Hebrew' | 'English'
  'Opening Government': string[]
  'Opening Opposition': string[]
  'Closing Government': string[]
  'Closing Opposition': string[]
  Chair: string[]
  Panel: string[]
  explanations?: string[]
}

export interface TrainingDrawState {
  rooms: TrainingRoomDraw[]
  waitlist: string[]
  trash: string[]
  strategy: PairingStrategy
  generated_at?: string | null
}

export interface TrainingSession {
  id: string
  title: string
  date: string
  time: string
  event_type: TrainingEventType
  status: TrainingSessionStatus
  motion: string
  info_slide: string
  motion_visible: boolean
  notes: string
  draw: TrainingDrawState
  created_at: string
}

export interface TrainingResult {
  id: string
  session_id: string | null
  session_date: string
  room_name: string
  member_id: string
  partner_id: string | null
  chair_id: string | null
  position: RoomRole
  team_rank: 1 | 2 | 3 | 4 | null
  speaker_points: number | null
  motion: string
  info_slide: string
  positive_feedback: string
  improvement_feedback: string
  created_at: string
}

export interface TrainingMotion {
  id: string
  category: string
  motion: string
  info_slide: string
  used_on: string | null
  created_at: string
}

export interface TrainingAnnouncement {
  id: string
  title: string
  body: string
  author_name: string
  pinned: boolean
  created_at: string
}

export interface MemberHistoryStats {
  memberId: string
  totalRounds: number
  debateRounds: number
  judgeRounds: number
  averageSpeaks: number | null
  firstPlaceCount: number
  positions: Record<RoomRole, number>
  leastPlayedPosition: BpPosition
  partnerCounts: Record<string, number>
  chairCounts: Record<string, number>
}

export interface PairingOptions {
  strategy: PairingStrategy
  honorPartnerRequests: boolean
  balanceLeastPlayedPositions: boolean
  rotateChairsAcrossJuniors: boolean
  respectLanguagePreference: boolean
  includeRegisteredNotCheckedIn: boolean
}
