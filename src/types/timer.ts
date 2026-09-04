/**
 * The interval (HIIT) timer.
 *
 * This is the one part of the app that is not server state: a timer config is a
 * personal scratchpad you rewrite between sets, and round-tripping every keystroke
 * through PostgREST would add a schema, an RLS policy and a migration for something
 * that never leaves the device. It lives in localStorage instead — see
 * `src/lib/timerStorage.ts`.
 */

/** One exercise in a group. `seconds` is the work interval, not a rep count. */
export interface IntervalExercise {
  id: string
  name: string
  seconds: number
}

/**
 * A block of exercises done back to back, repeated `rounds` times.
 *
 * `restSeconds` is the gap between two exercises inside a round; `roundRestSeconds`
 * is the longer gap between rounds. Both can be 0, which drops the phase entirely.
 */
export interface IntervalGroup {
  id: string
  name: string
  rounds: number
  restSeconds: number
  roundRestSeconds: number
  exercises: IntervalExercise[]
}

export interface TimerConfig {
  warmupSeconds: number
  cooldownSeconds: number
  /** The gap after a whole group finishes, before the next one starts. */
  groupRestSeconds: number
  groups: IntervalGroup[]
}

export type PhaseKind = 'WARMUP' | 'WORK' | 'REST' | 'ROUND_REST' | 'GROUP_REST' | 'COOLDOWN'

/**
 * One stretch of the countdown, after the config has been flattened.
 *
 * Positional fields are 1-based and forward-looking: a rest between rounds reports the
 * round it is leading *into*, because that is the number you want on screen while you
 * catch your breath. They are null where they do not apply (warm-up, cooldown).
 */
export interface Phase {
  key: string
  kind: PhaseKind
  seconds: number
  /** What to show, and what the voice announces: an exercise name, or "Warm up". */
  label: string
  groupIndex: number | null
  groupName: string | null
  round: number | null
  rounds: number | null
  exercise: number | null
  exercises: number | null
  /** Seconds from the start of the whole session. Makes seeking a subtraction. */
  startsAt: number
}

export const PHASE_LABELS: Record<PhaseKind, string> = {
  WARMUP: 'Warm up',
  WORK: 'Work',
  REST: 'Rest',
  ROUND_REST: 'Round rest',
  GROUP_REST: 'Group rest',
  COOLDOWN: 'Cool down',
}

/** Work is the only phase you are moving in. Everything else is a breather. */
export function isRest(kind: PhaseKind): boolean {
  return kind !== 'WORK'
}
