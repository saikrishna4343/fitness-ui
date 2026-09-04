import { useCallback, useEffect, useRef, useState } from 'react'
import { phaseIndexAt, type IntervalPlan } from '@/lib/intervalPlan'
import type { Phase } from '@/types/timer'

export type TimerStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'FINISHED'

export interface TimerCues {
  /** 3, 2 or 1 seconds left in the current phase. */
  onCount: (secondsLeft: number, current: Phase, next: Phase | null) => void
  /** A new phase has just begun. */
  onEnter: (phase: Phase, index: number) => void
  onFinish: () => void
}

const TICK_MS = 100

/**
 * The clock.
 *
 * Elapsed time is derived from a timestamp taken at the last start or resume, never
 * accumulated per tick: setInterval drifts, and a session of thirty 20-second intervals
 * would end visibly out of step with the voice. The interval only samples the clock, so
 * a throttled background tab catches up in one tick instead of falling behind by however
 * long it was hidden.
 *
 * Cues are fired from here rather than from a render effect so they key off the sampled
 * clock — a dropped frame delays the paint, never the countdown — and each one is guarded
 * by a ref so a re-render cannot say "two" twice.
 */
export function useIntervalTimer(plan: IntervalPlan, cues: TimerCues) {
  const [status, setStatus] = useState<TimerStatus>('IDLE')
  const [elapsed, setElapsed] = useState(0)

  const elapsedRef = useRef(0)
  const anchorRef = useRef(0)
  const spokenRef = useRef('')
  const phaseRef = useRef(-1)

  // Kept in refs so the ticking effect does not restart on every render of the page.
  // Written from an effect rather than during render: the tick and the controls only
  // ever read them after commit, so there is nothing to gain from the earlier write.
  const cuesRef = useRef(cues)
  const planRef = useRef(plan)
  useEffect(() => {
    cuesRef.current = cues
    planRef.current = plan
  })

  const apply = useCallback((seconds: number) => {
    elapsedRef.current = seconds
    setElapsed(seconds)
  }, [])

  const seek = useCallback(
    (seconds: number) => {
      const total = planRef.current.totalSeconds
      const next = Math.max(0, Math.min(total, seconds))
      apply(next)
      anchorRef.current = performance.now() - next * 1000

      // A seek lands mid-phase: forget what was said so the new phase announces itself
      // and its countdown is not suppressed as a duplicate.
      spokenRef.current = ''
      if (next >= total) {
        setStatus('FINISHED')
        phaseRef.current = -1
        cuesRef.current.onFinish()
      }
    },
    [apply],
  )

  useEffect(() => {
    if (status !== 'RUNNING') return

    const id = window.setInterval(() => {
      const { phases, totalSeconds } = planRef.current
      const seconds = Math.min(totalSeconds, (performance.now() - anchorRef.current) / 1000)
      apply(seconds)

      if (seconds >= totalSeconds) {
        setStatus('FINISHED')
        phaseRef.current = -1
        spokenRef.current = ''
        cuesRef.current.onFinish()
        return
      }

      const index = phaseIndexAt(phases, seconds)
      const phase = phases[index]
      const next = phases[index + 1] ?? null

      if (index !== phaseRef.current) {
        phaseRef.current = index
        cuesRef.current.onEnter(phase, index)
      }

      // Ceil, so the last whole second of a phase reads "1" and not "0": the display and
      // the voice agree, and the cue for a given number fires exactly once.
      const left = Math.ceil(phase.startsAt + phase.seconds - seconds)
      if (left >= 1 && left <= 3) {
        const key = `${index}:${left}`
        if (spokenRef.current !== key) {
          spokenRef.current = key
          cuesRef.current.onCount(left, phase, next)
        }
      }
    }, TICK_MS)

    return () => window.clearInterval(id)
  }, [status, apply])

  // Keeps the screen awake while running. A phone that locks mid-round takes the
  // countdown with it, and the browser suspends the interval behind the lock screen.
  useEffect(() => {
    if (status !== 'RUNNING' || !('wakeLock' in navigator)) return

    let sentinel: WakeLockSentinel | null = null
    let released = false

    async function acquire() {
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (released) {
          void lock.release()
          return
        }
        sentinel = lock
      } catch {
        // Denied, or the tab is hidden. Not worth telling anyone about.
      }
    }

    // The lock is dropped whenever the tab goes to the background, so it has to be
    // taken again on the way back or the screen sleeps for the rest of the session.
    function onVisible() {
      if (document.visibilityState === 'visible' && !sentinel) void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVisible)
      void sentinel?.release()
      sentinel = null
    }
  }, [status])

  const start = useCallback(() => {
    apply(0)
    phaseRef.current = -1
    spokenRef.current = ''
    anchorRef.current = performance.now()
    setStatus('RUNNING')
  }, [apply])

  const resume = useCallback(() => {
    anchorRef.current = performance.now() - elapsedRef.current * 1000
    setStatus('RUNNING')
  }, [])

  const pause = useCallback(() => setStatus('PAUSED'), [])

  const reset = useCallback(() => {
    apply(0)
    phaseRef.current = -1
    spokenRef.current = ''
    setStatus('IDLE')
  }, [apply])

  const { phases, totalSeconds } = plan
  const index = phaseIndexAt(phases, elapsed)
  const phase: Phase | undefined = phases[index]
  const finished = status === 'FINISHED' || !phase

  const skip = useCallback(() => {
    const current = planRef.current.phases[phaseIndexAt(planRef.current.phases, elapsedRef.current)]
    if (current) seek(current.startsAt + current.seconds)
  }, [seek])

  const back = useCallback(() => {
    const list = planRef.current.phases
    const at = phaseIndexAt(list, elapsedRef.current)
    const current = list[at]
    // Past the first second of a phase, "back" restarts it — the same rule as a music
    // player's previous-track button, and the one people press mid-interval.
    const target = elapsedRef.current - current.startsAt > 1 ? at : Math.max(0, at - 1)
    seek(list[target].startsAt)
  }, [seek])

  return {
    status,
    elapsed,
    remaining: Math.max(0, totalSeconds - elapsed),
    phase: finished ? null : phase,
    phaseIndex: finished ? -1 : index,
    nextPhase: finished ? null : (phases[index + 1] ?? null),
    secondsLeft: finished ? 0 : Math.max(0, Math.ceil(phase.startsAt + phase.seconds - elapsed)),
    start,
    pause,
    resume,
    reset,
    skip,
    back,
  }
}
