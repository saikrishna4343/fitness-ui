import { newId, WORKOUT_GROUP_ID } from '@/lib/timerStorage'
import type { Workout, WorkoutExercise } from '@/types/api'
import type { IntervalExercise, IntervalGroup, TimerConfig } from '@/types/timer'

/**
 * Keeping the timer and today's workout in step.
 *
 * The two used to meet in exactly one place — an empty day, adopted at Start — and only
 * in one direction. This module is the join: today's exercises become a group here, and
 * finishing their sets ticks them there.
 *
 * The link is `sessionExerciseId` on each interval exercise. It is what lets the sync
 * be idempotent (running it twice changes nothing), what lets your own timings survive
 * a refresh from the workout, and what the runner writes ticks against.
 */

const DEFAULT_SECONDS = 40

/**
 * How long to work an exercise for, from what the workout says about it.
 *
 * A workout is written in reps ("8-10"), which say nothing about duration — except
 * when they are already a duration, which is exactly what the timer writes back when
 * it pushes its own exercises across ("45s"). Reading that back means a round trip
 * through the workout screen does not quietly reset every interval to 40 seconds.
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

function fromWorkoutExercise(
  exercise: WorkoutExercise,
  previous: IntervalExercise | undefined,
): IntervalExercise {
  return {
    // The id is kept when the exercise was already here, so React does not remount the
    // row -- and so an in-flight edit is not thrown away by a refresh.
    id: previous?.id ?? newId(),
    name: exercise.name,
    // Your timing wins over the default. You set 30 seconds for burpees on purpose;
    // a refresh because a different exercise was added must not undo that.
    seconds: previous?.seconds ?? secondsFromReps(exercise.targetReps),
    sets: previous?.sets ?? Math.max(1, exercise.targetSets),
    sessionExerciseId: exercise.id,
  }
}

/**
 * The group as today's workout would have it: same exercises, same order.
 *
 * Straight sets rather than a circuit, because a workout is written that way -- 5x5
 * squats then 3x15 calf raises cannot be expressed as one round count for the group.
 */
export function workoutGroup(workout: Workout, previous: IntervalGroup | undefined): IntervalGroup {
  const byId = new Map((previous?.exercises ?? []).map((e) => [e.sessionExerciseId, e]))

  return {
    id: WORKOUT_GROUP_ID,
    name: workout.focus?.trim() || "Today's workout",
    style: 'SETS',
    // Unused in SETS, but the plan builder drops any group with rounds <= 0.
    rounds: 1,
    restSeconds: previous?.restSeconds ?? 45,
    roundRestSeconds: previous?.roundRestSeconds ?? 90,
    exercises: workout.exercises.map((exercise) =>
      fromWorkoutExercise(exercise, byId.get(exercise.id)),
    ),
  }
}

export function findWorkoutGroup(config: TimerConfig): IntervalGroup | undefined {
  return config.groups.find((group) => group.id === WORKOUT_GROUP_ID)
}

/**
 * Pulls today's workout into the config, preserving whatever you have set here.
 *
 * Idempotent: with nothing changed on the workout, this returns a config equal to the
 * one it was given, which is what makes it safe to offer as a one-click refresh.
 */
export function syncFromWorkout(config: TimerConfig, workout: Workout): TimerConfig {
  const previous = findWorkoutGroup(config)
  const group = workoutGroup(workout, previous)

  if (workout.exercises.length === 0) {
    // An empty day should not leave an empty group sitting at the top of the editor.
    return { ...config, groups: config.groups.filter((g) => g.id !== WORKOUT_GROUP_ID) }
  }

  return {
    ...config,
    groups: previous
      ? config.groups.map((g) => (g.id === WORKOUT_GROUP_ID ? group : g))
      : // First, because it is the day's actual work; anything else is extra.
        [group, ...config.groups],
  }
}

/**
 * Whether the workout has exercises the timer has not seen, or vice versa.
 *
 * Only membership, never timings: a refresh keeps your seconds and sets, so a
 * difference in those is not something to nag about.
 */
export function workoutDiffers(config: TimerConfig, workout: Workout | undefined): boolean {
  if (!workout) return false
  const group = findWorkoutGroup(config)
  const here = new Set((group?.exercises ?? []).map((e) => e.sessionExerciseId).filter(Boolean))
  const there = new Set(workout.exercises.map((e) => e.id))

  if (here.size !== there.size) return true
  for (const id of there) if (!here.has(id)) return true
  return false
}

/** Every exercise in the config that is not yet a row on today's workout. */
export function unlinkedExercises(config: TimerConfig): IntervalExercise[] {
  return config.groups.flatMap((group) =>
    group.exercises.filter((exercise) => !exercise.sessionExerciseId),
  )
}

/** Writes ids back onto the exercises that were just created on the workout. */
export function withSessionIds(
  config: TimerConfig,
  ids: Map<string, string>,
): TimerConfig {
  if (ids.size === 0) return config
  return {
    ...config,
    groups: config.groups.map((group) => ({
      ...group,
      exercises: group.exercises.map((exercise) =>
        ids.has(exercise.id)
          ? { ...exercise, sessionExerciseId: ids.get(exercise.id) ?? null }
          : exercise,
      ),
    })),
  }
}
