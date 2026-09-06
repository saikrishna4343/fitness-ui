/**
 * The interval (HIIT) timer.
 *
 * The config is not server state: it is a personal scratchpad you rewrite between
 * sets, and round-tripping every keystroke through PostgREST would add a schema, an
 * RLS policy and a migration for something that never leaves the device. It lives in
 * localStorage instead — see `src/lib/timerStorage.ts`.
 *
 * What *is* server state is the workout it drives. An exercise carrying a
 * `sessionExerciseId` is the same exercise as the row on the Workout screen: finishing
 * its last set here ticks it there, and adding it there brings it here.
 */

/**
 * How a group is run.
 *
 * `CIRCUIT` — round-robin: every exercise once, then again, `rounds` times. The HIIT
 * shape, and what the timer did before it knew about workouts.
 *
 * `SETS` — one exercise at a time, all of its sets, then the next. The gym shape, and
 * the only one that can represent a workout where the squats are 5×5 and the calf
 * raises are 3×15 — a single `rounds` for the whole group cannot.
 */
export type GroupStyle = 'CIRCUIT' | 'SETS'

export interface IntervalExercise {
  id: string
  name: string
  /** The work interval, not a rep count. */
  seconds: number
  /** `SETS` only. Ignored in a circuit, where the group's rounds apply to everyone. */
  sets: number
  /**
   * The row on today's workout this stands for, when it came from there or was
   * pushed there. Null for an exercise that exists only in the timer.
   */
  sessionExerciseId: string | null
}

export interface IntervalGroup {
  id: string
  name: string
  style: GroupStyle
  /** `CIRCUIT` only: how many times through the whole group. */
  rounds: number
  /** The short gap: between exercises in a circuit, between sets in `SETS`. */
  restSeconds: number
  /** The long gap: between rounds in a circuit, between exercises in `SETS`. */
  roundRestSeconds: number
  exercises: IntervalExercise[]
}

export interface TimerConfig {
  warmupSeconds: number
  cooldownSeconds: number
  /** The gap after a whole group finishes, before the next one starts. */
  groupRestSeconds: number
  groups: IntervalGroup[]
  /**
   * Exercises on today's workout deliberately left out of the timer.
   *
   * Remembered, because otherwise the next sync would put back the thing you just
   * took out -- the merge cannot tell "not here yet" from "not wanted" without it.
   */
  excludedExerciseIds: string[]
  /**
   * The group number typed against each of today's exercises, by session exercise id.
   *
   * Held apart from the groups themselves because it is an intention, not a fact: you
   * renumber the whole list and then press the button, and nothing rearranges under
   * your hands in between. 0 means leave this one out.
   */
  groupNumbers: Record<string, number>
  /**
   * Whether finishing work here writes back to today's workout.
   *
   * On by default, and worth being able to turn off: a quick five-minute circuit
   * should not necessarily append five rows to a day you had planned properly.
   */
  syncWithWorkout: boolean
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
  /** Set on work phases: the exercise being worked, for writing back. */
  exerciseId: string | null
  sessionExerciseId: string | null
  /**
   * True on the last work phase of an exercise — its final set, or its last round.
   * When this phase ends, that exercise is done and can be ticked on the workout.
   */
  completesExercise: boolean
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
