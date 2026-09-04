import type { Phase, TimerConfig } from '@/types/timer'

export interface IntervalPlan {
  phases: Phase[]
  totalSeconds: number
}

/**
 * Flattens a config into the running order, once, before the clock starts.
 *
 * Everything downstream — the countdown, the voice cues, skip, the progress bar — reads
 * this array and nothing else, so there is no nested round/exercise bookkeeping running
 * inside a setInterval, and seeking is a lookup rather than a replay.
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
  }

  push({ kind: 'WARMUP', seconds: config.warmupSeconds, label: 'Warm up', ...blank })

  // An empty group has nothing to rest between either, so it is dropped whole.
  const groups = config.groups.filter((group) => group.exercises.length > 0 && group.rounds > 0)

  groups.forEach((group, groupIndex) => {
    const exercises = group.exercises.length
    const position = { groupIndex, groupName: group.name, rounds: group.rounds, exercises }

    for (let round = 1; round <= group.rounds; round += 1) {
      group.exercises.forEach((exercise, index) => {
        push({
          kind: 'WORK',
          seconds: exercise.seconds,
          label: exercise.name.trim() || `Exercise ${index + 1}`,
          round,
          exercise: index + 1,
          ...position,
        })

        // The gap between two exercises. Not after the last one — the round rest,
        // the group rest or the cooldown covers that, and stacking both would leave
        // you standing still for the sum of the two.
        if (index < exercises - 1) {
          push({
            kind: 'REST',
            seconds: group.restSeconds,
            label: `Next: ${group.exercises[index + 1].name.trim() || `Exercise ${index + 2}`}`,
            round,
            exercise: index + 1,
            ...position,
          })
        }
      })

      if (round < group.rounds) {
        push({
          kind: 'ROUND_REST',
          seconds: group.roundRestSeconds,
          // Forward-looking on purpose: mid-rest you care about the round you are
          // about to start, not the one behind you.
          label: `Next: round ${round + 1} of ${group.rounds}`,
          round: round + 1,
          exercise: null,
          ...position,
        })
      }
    }

    if (groupIndex < groups.length - 1) {
      const next = groups[groupIndex + 1]
      push({
        kind: 'GROUP_REST',
        seconds: config.groupRestSeconds,
        label: `Next: ${next.name}`,
        groupIndex: groupIndex + 1,
        groupName: next.name,
        round: 1,
        rounds: next.rounds,
        exercise: null,
        exercises: next.exercises.length,
      })
    }
  })

  push({ kind: 'COOLDOWN', seconds: config.cooldownSeconds, label: 'Cool down', ...blank })

  return { phases, totalSeconds: startsAt }
}

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

/** Total work time in a config, for the summary line above the Start button. */
export function countWork(config: TimerConfig): { exercises: number; rounds: number } {
  return config.groups.reduce(
    (total, group) =>
      group.exercises.length > 0 && group.rounds > 0
        ? {
            exercises: total.exercises + group.exercises.length * group.rounds,
            rounds: total.rounds + group.rounds,
          }
        : total,
    { exercises: 0, rounds: 0 },
  )
}
