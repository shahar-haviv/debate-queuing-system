/**
 * Cross-cutting constants. Domain modules re-export the ones that used to live
 * there, so existing imports keep working while new code has one source.
 */
import type { RoomType, TaskAssignment } from './types'

export const DEBATE_INTERVIEW = 'Debate Interview' as const
export const PERSONAL_INTERVIEW = 'Personal Interview' as const

export const TASKS: readonly TaskAssignment[] = [DEBATE_INTERVIEW, PERSONAL_INTERVIEW]

export const ROOM_TYPES: readonly RoomType[] = ['Debate', 'Personal', 'General']

/** The task a room type hosts; `General` hosts either, so it has no default. */
export const TASK_FOR_ROOM_TYPE: Record<RoomType, TaskAssignment | null> = {
  Debate: DEBATE_INTERVIEW,
  Personal: PERSONAL_INTERVIEW,
  General: null,
}

export const LATE_THRESHOLD_MINUTES = 15
export const ROOM_LONG_THRESHOLD_MINUTES = 20
export const LONG_SESSION_MINUTES = 20

export const UNKNOWN_ROOM = 'Unknown room'
export const UNATTRIBUTED = 'Unattributed'

export const LOG_STORAGE_KEY = 'cq:logLevel'

export const APP_NAME = 'Candidate Queue'
export const APP_DESCRIPTION = 'Candidate Queue & Dispatch Management'
