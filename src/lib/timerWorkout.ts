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
 * idempotent, what lets your own timings and grouping survive the workout changing under
 * them, and what the runner writes ticks against.
 *
 * The sync only ever *adds* and *removes*. Which group an exercise sits in is yours: an
 * exercise already somewhere in the config is left exactly where you put it.
 */

const DEFAULT_SECONDS = 40

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

function toInterval(exercise: WorkoutExercise): IntervalExercise {
  return {
    id: newId(),
    name: exercise.name,
    seconds: secondsFromReps(exercise.targetReps),
    sets: Math.max(1, exercise.targetSets),
    sessionExerciseId: exercise.id,
  }
}

/** Where an exercise from today's workout currently sits, if it is in the config. */
export function groupOf(config: TimerConfig, sessionExerciseId: string): IntervalGroup | undefined {
  return config.groups.find((group) =>
    group.exercises.some((exercise) => exercise.sessionExerciseId === sessionExerciseId),
  )
}

export function findWorkoutGroup(config: TimerConfig): IntervalGroup | undefined {
  return config.groups.find((group) => group.id === WORKOUT_GROUP_ID)
}

/** The group new exercises land in: the one the app made, or the first there is. */
function landingGroup(config: TimerConfig): IntervalGroup | undefined {
  return findWorkoutGroup(config) ?? config.groups[0]
}

/**
 * Folds today's workout into the config.
 *
 * Adds what is new, drops what is gone, and touches nothing else — an exercise you moved
 * into another group stays there, and one you set to 30 seconds stays at 30. Idempotent,
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

  const landing = landingGroup({ ...config, groups })
  if (landing) {
    groups = groups.map((group) =>
      group.id === landing.id
        ? { ...group, exercises: [...group.exercises, ...missing.map(toInterval)] }
        : group,
    )
  } else {
    // Nothing to land in: the config is empty, so today's workout becomes the session.
    // Straight sets, because that is how a workout is written -- 5x5 then 3x15 cannot be
    // said with one round count for the group.
    groups = [
      {
        id: WORKOUT_GROUP_ID,
        name: workout.focus?.trim() || "Today's workout",
        style: 'SETS',
        rounds: 1,
        restSeconds: 45,
        roundRestSeconds: 90,
        exercises: missing.map(toInterval),
      },
    ]
  }

  return { ...config, groups }
}

/**
 * Moves one of today's exercises into a group, or out of the session entirely.
 *
 * `null` excludes it: the exercise stays on the workout, and stays untouched by the
 * timer, which is what you want for the thing you are doing outside the app. The
 * exclusion is remembered, or the next sync would put it straight back.
 */
export function assignToGroup(
  config: TimerConfig,
  sessionExerciseId: string,
  groupId: string | null,
  fromWorkout: WorkoutExercise,
): TimerConfig {
  const current = groupOf(config, sessionExerciseId)
  const moving =
    current?.exercises.find((exercise) => exercise.sessionExerciseId === sessionExerciseId) ??
    toInterval(fromWorkout)

  const without = config.groups.map((group) => ({
    ...group,
    exercises: group.exercises.filter(
      (exercise) => exercise.sessionExerciseId !== sessionExerciseId,
    ),
  }))

  const excluded = config.excludedExerciseIds.filter((id) => id !== sessionExerciseId)

  if (groupId === null) {
    return { ...config, groups: without, excludedExerciseIds: [...excluded, sessionExerciseId] }
  }

  return {
    ...config,
    excludedExerciseIds: excluded,
    groups: without.map((group) =>
      group.id === groupId ? { ...group, exercises: [...group.exercises, moving] } : group,
    ),
  }
}
