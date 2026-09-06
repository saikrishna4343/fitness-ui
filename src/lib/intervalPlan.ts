import type { IntervalGroup, Phase, TimerConfig } from '@/types/timer'

export interface IntervalPlan {
  phases: Phase[]
  totalSeconds: number
}

/**
 * Flattens a config into the running order, once, before the clock starts.
 *
 * Everything downstream — the countdown, the voice cues, skip, the progress bar, the
 * ticks written back to today's workout — reads this array and nothing else, so there
 * is no nested round/exercise bookkeeping running inside a setInterval, and seeking is
 * a lookup rather than a replay.
 */
export function buildPlan(config: TimerConfig): IntervalPlan {
  const phases: Phase[] = []
  let startsAt = 0

  function push(phase: Omit<Phase, 'key' | 'startsAt'>) {
    // A zero-second phase would flash past and speak its cue over the next one's, so a
    // rest set to 0 is simply not part of the session.
    if (phase.seconds <= 0) return
    phases.push({ ...phase, key: `${phase.kind}-${phases.length}`, startsAt })
    startsAt += phase.seconds
  }

  const blank = {
    groupIndex: null,
    groupName: null,
    round: null,
    rounds: null,
    exercise: null,
    exercises: null,
    exerciseId: null,
    sessionExerciseId: null,
    completesExercise: false,
  }

  push({ kind: 'WARMUP', seconds: config.warmupSeconds, label: 'Warm up', ...blank })

  const groups = config.groups.filter((group) => group.exercises.length > 0 && group.rounds > 0)

  groups.forEach((group, groupIndex) => {
    if (group.style === 'SETS') pushSets(group, groupIndex)
    else pushCircuit(group, groupIndex)

    if (groupIndex < groups.length - 1) {
      const next = groups[groupIndex + 1]
      push({
        ...blank,
        kind: 'GROUP_REST',
        seconds: config.groupRestSeconds,
        label: `Next: ${next.name}`,
        groupIndex: groupIndex + 1,
        groupName: next.name,
        round: 1,
        rounds: next.style === 'SETS' ? (next.exercises[0]?.sets ?? 1) : next.rounds,
        exercises: next.exercises.length,
      })
    }
  })

  push({ kind: 'COOLDOWN', seconds: config.cooldownSeconds, label: 'Cool down', ...blank })

  /** Round-robin: everyone once, then again. */
  function pushCircuit(group: IntervalGroup, groupIndex: number) {
    const count = group.exercises.length
    const position = { groupIndex, groupName: group.name, rounds: group.rounds, exercises: count }

    for (let round = 1; round <= group.rounds; round += 1) {
      group.exercises.forEach((exercise, index) => {
        push({
          ...position,
          kind: 'WORK',
          seconds: exercise.seconds,
          label: exercise.name.trim() || `Exercise ${index + 1}`,
          round,
          exercise: index + 1,
          exerciseId: exercise.id,
          sessionExerciseId: exercise.sessionExerciseId,
          // In a circuit an exercise is finished when its last round is done, which
          // is the last time round the loop -- not the end of the first pass.
          completesExercise: round === group.rounds,
        })

        // The gap between two exercises. Not after the last one — the round rest, the
        // group rest or the cooldown covers that, and stacking both would leave you
        // standing still for the sum of the two.
        if (index < count - 1) {
          push({
            ...position,
            ...restBlank,
            kind: 'REST',
            seconds: group.restSeconds,
            label: `Next: ${group.exercises[index + 1].name.trim() || `Exercise ${index + 2}`}`,
            round,
            exercise: index + 1,
          })
        }
      })

      if (round < group.rounds) {
        push({
          ...position,
          ...restBlank,
          kind: 'ROUND_REST',
          seconds: group.roundRestSeconds,
          // Forward-looking on purpose: mid-rest you care about the round you are
          // about to start, not the one behind you.
          label: `Next: round ${round + 1} of ${group.rounds}`,
          round: round + 1,
          exercise: null,
        })
      }
    }
  }

  /** One exercise at a time, all of its sets, then the next. */
  function pushSets(group: IntervalGroup, groupIndex: number) {
    const count = group.exercises.length

    group.exercises.forEach((exercise, index) => {
      const sets = Math.max(1, exercise.sets)
      const position = {
        groupIndex,
        groupName: group.name,
        rounds: sets,
        exercises: count,
        exercise: index + 1,
      }

      for (let set = 1; set <= sets; set += 1) {
        push({
          ...position,
          kind: 'WORK',
          seconds: exercise.seconds,
          label: exercise.name.trim() || `Exercise ${index + 1}`,
          round: set,
          exerciseId: exercise.id,
          sessionExerciseId: exercise.sessionExerciseId,
          completesExercise: set === sets,
        })

        if (set < sets) {
          push({
            ...position,
            ...restBlank,
            kind: 'REST',
            seconds: group.restSeconds,
            label: `Next: set ${set + 1} of ${sets}`,
            round: set + 1,
          })
        }
      }

      // The longer gap belongs between exercises here, not between rounds — there are
      // no rounds in this shape.
      if (index < count - 1) {
        const next = group.exercises[index + 1]
        push({
          ...restBlank,
          kind: 'ROUND_REST',
          seconds: group.roundRestSeconds,
          label: `Next: ${next.name.trim() || `Exercise ${index + 2}`}`,
          groupIndex,
          groupName: group.name,
          round: 1,
          rounds: Math.max(1, next.sets),
          exercise: index + 2,
          exercises: count,
        })
      }
    })
  }

  return { phases, totalSeconds: startsAt }
}

/** Rests belong to no exercise: they must never tick anything on the workout. */
const restBlank = { exerciseId: null, sessionExerciseId: null, completesExercise: false }

/** The phase covering `second`, or the last one once the session has run out. */
export function phaseIndexAt(phases: Phase[], second: number): number {
  for (let i = phases.length - 1; i >= 0; i -= 1) {
    if (second >= phases[i].startsAt) return i
  }
  return 0
}

/** `m:ss`, or `h:mm:ss` once a session runs past an hour. */
export function mmss(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60

  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(rest).padStart(2, '0')}`
}

/** Total work in a config, for the summary line above the Start button. */
export function countWork(config: TimerConfig): { exercises: number; rounds: number } {
  return config.groups.reduce(
    (total, group) => {
      if (group.exercises.length === 0 || group.rounds <= 0) return total
      if (group.style === 'SETS') {
        const sets = group.exercises.reduce((n, e) => n + Math.max(1, e.sets), 0)
        return { exercises: total.exercises + sets, rounds: total.rounds + group.exercises.length }
      }
      return {
        exercises: total.exercises + group.exercises.length * group.rounds,
        rounds: total.rounds + group.rounds,
      }
    },
    { exercises: 0, rounds: 0 },
  )
}

/** Seconds a group takes, both shapes. Shown per group in the editor. */
export function groupSeconds(group: IntervalGroup): number {
  if (group.style === 'SETS') {
    const work = group.exercises.reduce(
      (total, exercise) => total + exercise.seconds * Math.max(1, exercise.sets),
      0,
    )
    const between = group.exercises.reduce(
      (total, exercise) => total + Math.max(0, Math.max(1, exercise.sets) - 1) * group.restSeconds,
      0,
    )
    return work + between + Math.max(0, group.exercises.length - 1) * group.roundRestSeconds
  }

  const work = group.exercises.reduce((total, exercise) => total + exercise.seconds, 0)
  const gaps = Math.max(0, group.exercises.length - 1) * group.restSeconds
  return group.rounds * (work + gaps) + Math.max(0, group.rounds - 1) * group.roundRestSeconds
}
