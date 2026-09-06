import { newId, WORKOUT_GROUP_ID } from '@/lib/timerStorage'
import type { Workout, WorkoutExercise } from '@/types/api'
import type { IntervalExercise, IntervalGroup, TimerConfig } from '@/types/timer'

/**
 * Keeping the timer and today's workout in step.
 *
 * The two used to meet in exactly one place — an empty day, adopted at Start — and only
 * in one direction. This module is the join: today's exercises appear here on their own,
 * and finishing their sets ticks them there.
 *
 * The link is `sessionExerciseId` on each interval exercise. It is what lets the sync be
 * idempotent, what lets your timings survive the workout changing under them, and what
 * the runner writes ticks against.
 */

const DEFAULT_SECONDS = 40

/** The rest a freshly-formed group gets, both between exercises and between groups. */
export const DEFAULT_REST_SECONDS = 45

/**
 * How long to work an exercise for, from what the workout says about it.
 *
 * A workout is written in reps ("8-10"), which say nothing about duration — except when
 * they are already a duration, which is exactly what the timer writes back when it
 * pushes its own exercises across ("45s"). Reading that back means a round trip through
 * the Workout screen does not quietly reset every interval to 40 seconds.
 */
export function secondsFromReps(reps: string | null | undefined): number {
  const match = /^\s*(\d+)\s*s(ec(onds?)?)?\s*$/i.exec(reps ?? '')
  if (!match) return DEFAULT_SECONDS
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? Math.min(3600, value) : DEFAULT_SECONDS
}

/** The reps string written back to the workout for a timed exercise. */
export function repsFromSeconds(seconds: number): string {
  return `${Math.max(1, Math.round(seconds))}s`
}

function toInterval(exercise: WorkoutExercise, previous?: IntervalExercise): IntervalExercise {
  return {
    id: previous?.id ?? newId(),
    name: exercise.name,
    // Your timing wins over the default: you set 30 seconds for burpees on purpose.
    seconds: previous?.seconds ?? secondsFromReps(exercise.targetReps),
    sets: previous?.sets ?? Math.max(1, exercise.targetSets),
    sessionExerciseId: exercise.id,
  }
}

/** Where an exercise from today's workout currently sits, if it is in the config. */
export function groupOf(config: TimerConfig, sessionExerciseId: string): IntervalGroup | undefined {
  return config.groups.find((group) =>
    group.exercises.some((exercise) => exercise.sessionExerciseId === sessionExerciseId),
  )
}

function intervalOf(
  config: TimerConfig,
  sessionExerciseId: string,
): IntervalExercise | undefined {
  return groupOf(config, sessionExerciseId)?.exercises.find(
    (exercise) => exercise.sessionExerciseId === sessionExerciseId,
  )
}

export function findWorkoutGroup(config: TimerConfig): IntervalGroup | undefined {
  return config.groups.find((group) => group.id === WORKOUT_GROUP_ID)
}

/** True for a group the user built themselves, rather than one formed from the workout. */
function isOwnGroup(group: IntervalGroup): boolean {
  return group.exercises.length > 0 && group.exercises.every((e) => !e.sessionExerciseId)
}

/**
 * The number typed against an exercise, or the number its group implies.
 *
 * Everything defaults to 1, so a workout that is one straight session needs nothing
 * typed at all — the numbers only matter when you want to split it.
 */
export function groupNumberOf(config: TimerConfig, sessionExerciseId: string): number {
  const stored = config.groupNumbers[sessionExerciseId]
  if (typeof stored === 'number') return stored
  return config.excludedExerciseIds.includes(sessionExerciseId) ? 0 : 1
}

export function setGroupNumber(
  config: TimerConfig,
  sessionExerciseId: string,
  value: number,
): TimerConfig {
  return {
    ...config,
    groupNumbers: { ...config.groupNumbers, [sessionExerciseId]: Math.max(0, Math.round(value)) },
  }
}

/**
 * Whether the numbers as typed differ from the groups as they stand.
 *
 * What the "Break into groups" button is enabled by: no point offering to rebuild
 * something that already matches.
 */
export function groupingPending(config: TimerConfig, workout: Workout | undefined): boolean {
  if (!workout) return false
  return workout.exercises.some((exercise) => {
    const number = groupNumberOf(config, exercise.id)
    const group = groupOf(config, exercise.id)
    if (number === 0) return group !== undefined
    if (!group) return true
    return group.name !== `Group ${number}`
  })
}

/**
 * Forms the groups from the numbers.
 *
 * Same number, same group — which is the whole rule, and why the input is a number
 * rather than a picker: typing 1, 1, 2, 2 is faster than four dropdowns, and says the
 * shape of the session at a glance.
 *
 * Groups arrive as straight sets, because a workout is written that way: 5x5 squats and
 * 3x15 calf raises cannot share one round count. Rests start at 45 seconds and are
 * yours to change per group afterwards.
 */
export function breakIntoGroups(config: TimerConfig, workout: Workout): TimerConfig {
  const numbered = new Map<number, WorkoutExercise[]>()
  const excluded: string[] = []

  for (const exercise of workout.exercises) {
    const number = groupNumberOf(config, exercise.id)
    if (number <= 0) {
      excluded.push(exercise.id)
      continue
    }
    const bucket = numbered.get(number) ?? []
    bucket.push(exercise)
    numbered.set(number, bucket)
  }

  const formed: IntervalGroup[] = [...numbered.entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, exercises], index) => {
      // The group in this slot before the rebuild, so its rests survive a renumber.
      const previous = config.groups.find((group) => group.name === `Group ${number}`)
      return {
        // The first formed group keeps the well-known id, so anything added on the
        // Workout screen later still has somewhere obvious to land.
        id: index === 0 ? WORKOUT_GROUP_ID : (previous?.id ?? newId()),
        name: `Group ${number}`,
        style: 'SETS' as const,
        rounds: 1,
        restSeconds: previous?.restSeconds ?? DEFAULT_REST_SECONDS,
        roundRestSeconds: previous?.roundRestSeconds ?? DEFAULT_REST_SECONDS,
        exercises: exercises.map((exercise) => toInterval(exercise, intervalOf(config, exercise.id))),
      }
    })

  return {
    ...config,
    // Groups you built yourself are none of this rebuild's business, so they survive it.
    groups: [...formed, ...config.groups.filter(isOwnGroup)],
    excludedExerciseIds: excluded,
    groupRestSeconds:
      formed.length > 1 && config.groupRestSeconds === 90
        ? DEFAULT_REST_SECONDS
        : config.groupRestSeconds,
  }
}

/**
 * Folds today's workout into the config.
 *
 * Adds what is new, drops what is gone, and touches nothing else — an exercise you put
 * in group 2 stays in group 2, and one you set to 30 seconds stays at 30. Idempotent,
 * which is what makes it safe to run on every render.
 */
export function syncFromWorkout(config: TimerConfig, workout: Workout): TimerConfig {
  const onToday = new Map(workout.exercises.map((exercise) => [exercise.id, exercise]))
  const excluded = new Set(config.excludedExerciseIds)

  // Drop anything that was on today's workout and is not any more. An exercise with no
  // session id was never from the workout, so it is left alone.
  let groups = config.groups.map((group) => ({
    ...group,
    exercises: group.exercises.filter(
      (exercise) => !exercise.sessionExerciseId || onToday.has(exercise.sessionExerciseId),
    ),
  }))

  const known = new Set(
    groups.flatMap((group) =>
      group.exercises.map((exercise) => exercise.sessionExerciseId).filter(Boolean),
    ),
  )
  const missing = workout.exercises.filter(
    (exercise) => !known.has(exercise.id) && !excluded.has(exercise.id),
  )

  if (missing.length === 0) return { ...config, groups }

  const landing = findWorkoutGroup({ ...config, groups }) ?? groups[0]
  if (landing) {
    groups = groups.map((group) =>
      group.id === landing.id
        ? { ...group, exercises: [...group.exercises, ...missing.map((e) => toInterval(e))] }
        : group,
    )
  } else {
    groups = [
      {
        id: WORKOUT_GROUP_ID,
        name: 'Group 1',
        style: 'SETS',
        rounds: 1,
        restSeconds: DEFAULT_REST_SECONDS,
        roundRestSeconds: DEFAULT_REST_SECONDS,
        exercises: missing.map((e) => toInterval(e)),
      },
    ]
  }

  return { ...config, groups }
}
