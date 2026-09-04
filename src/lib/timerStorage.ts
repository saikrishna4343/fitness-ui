import { defaultSound, type BeepLevel, type SoundSettings } from '@/lib/speech'
import type { IntervalExercise, IntervalGroup, TimerConfig } from '@/types/timer'

const KEY = 'fitness-ui:interval-timer'
const SOUND_KEY = 'fitness-ui:interval-timer-sound'
const SESSION_KEY = 'fitness-ui:interval-timer-session'

export function newId(): string {
  return crypto.randomUUID()
}

export function newExercise(name = '', seconds = 40): IntervalExercise {
  return { id: newId(), name, seconds }
}

export function newGroup(index: number): IntervalGroup {
  return {
    id: newId(),
    name: `Group ${index + 1}`,
    rounds: 3,
    restSeconds: 20,
    roundRestSeconds: 60,
    exercises: [newExercise('Squats'), newExercise('Push-ups'), newExercise('Mountain climbers')],
  }
}

export function defaultConfig(): TimerConfig {
  return {
    warmupSeconds: 60,
    cooldownSeconds: 90,
    groupRestSeconds: 90,
    groups: [newGroup(0)],
  }
}

const MAX_SECONDS = 60 * 60

function seconds(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_SECONDS, Math.max(0, Math.round(value)))
    : fallback
}

/**
 * Rebuilds a config from whatever is in storage.
 *
 * Every field is re-checked rather than trusted: this JSON survives across deploys, so
 * it can be a shape an older build wrote, or something hand-edited in devtools. A
 * missing number here would reach the timer as NaN and hang the clock on one phase
 * forever, which reads as the app being broken rather than the saved config being stale.
 */
function parse(raw: unknown): TimerConfig | null {
  if (typeof raw !== 'object' || raw === null) return null
  const source = raw as Record<string, unknown>
  if (!Array.isArray(source.groups)) return null

  const groups = source.groups.flatMap((entry): IntervalGroup[] => {
    if (typeof entry !== 'object' || entry === null) return []
    const group = entry as Record<string, unknown>
    const exercises = Array.isArray(group.exercises)
      ? group.exercises.flatMap((item): IntervalExercise[] => {
          if (typeof item !== 'object' || item === null) return []
          const exercise = item as Record<string, unknown>
          return [
            {
              id: typeof exercise.id === 'string' ? exercise.id : newId(),
              name: typeof exercise.name === 'string' ? exercise.name : '',
              // A zero-second exercise is dropped by the plan builder, so the floor is 1.
              seconds: Math.max(1, seconds(exercise.seconds, 40)),
            },
          ]
        })
      : []

    return [
      {
        id: typeof group.id === 'string' ? group.id : newId(),
        name: typeof group.name === 'string' ? group.name : 'Group',
        rounds: Math.min(50, Math.max(1, seconds(group.rounds, 3))),
        restSeconds: seconds(group.restSeconds, 20),
        roundRestSeconds: seconds(group.roundRestSeconds, 60),
        exercises,
      },
    ]
  })

  return {
    warmupSeconds: seconds(source.warmupSeconds, 60),
    cooldownSeconds: seconds(source.cooldownSeconds, 90),
    groupRestSeconds: seconds(source.groupRestSeconds, 90),
    groups,
  }
}

export function loadConfig(): TimerConfig {
  try {
    const raw = localStorage.getItem(KEY)
    return (raw ? parse(JSON.parse(raw)) : null) ?? defaultConfig()
  } catch {
    // Private mode, a quota error, or malformed JSON. Start fresh rather than fail.
    return defaultConfig()
  }
}

export function saveConfig(config: TimerConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(config))
  } catch {
    /* nothing to do — the timer still runs from memory */
  }
}

// ------------------------------------------------------------------ sound

const BEEP_LEVELS: BeepLevel[] = ['off', 'normal', 'loud']

/**
 * Kept apart from the config: which voice sounds good is a property of the device you
 * are holding, not of the workout, so it survives a Reset of the intervals.
 */
export function loadSound(): SoundSettings {
  try {
    const raw = localStorage.getItem(SOUND_KEY)
    if (!raw) return defaultSound
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return defaultSound
    const source = parsed as Record<string, unknown>

    return {
      voiceURI: typeof source.voiceURI === 'string' ? source.voiceURI : null,
      rate:
        typeof source.rate === 'number' && Number.isFinite(source.rate)
          ? Math.min(2, Math.max(0.5, source.rate))
          : defaultSound.rate,
      beeps: BEEP_LEVELS.includes(source.beeps as BeepLevel)
        ? (source.beeps as BeepLevel)
        : defaultSound.beeps,
    }
  } catch {
    return defaultSound
  }
}

export function saveSound(settings: SoundSettings): void {
  try {
    localStorage.setItem(SOUND_KEY, JSON.stringify(settings))
  } catch {
    /* nothing to do */
  }
}

// ------------------------------------------------------------------ session

/** Where a running session had got to, so a reload does not throw the workout away. */
export interface SavedSession {
  /** The config the session was started with, not whatever the editor holds now. */
  config: TimerConfig
  elapsed: number
  savedAt: number
}

/**
 * How long a snapshot is worth offering. Past this it is yesterday's workout, and
 * resuming into the middle of it would be stranger than starting again.
 */
const SESSION_TTL_MS = 6 * 60 * 60 * 1000

export function saveSession(session: SavedSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    /* nothing to do — the session still runs, it just will not survive a reload */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    /* nothing to do */
  }
}

export function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const source = parsed as Record<string, unknown>

    const elapsed = typeof source.elapsed === 'number' ? source.elapsed : 0
    const savedAt = typeof source.savedAt === 'number' ? source.savedAt : 0
    if (elapsed <= 0 || Date.now() - savedAt > SESSION_TTL_MS) return null

    // Same validation as the editor config: this JSON outlives deploys too.
    const config = parse(source.config)
    if (!config || config.groups.length === 0) return null

    return { config, elapsed, savedAt }
  } catch {
    return null
  }
}
