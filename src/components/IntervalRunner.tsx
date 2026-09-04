import { Pause, Play, RotateCcw, SkipBack, SkipForward, Square, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { buildPlan, mmss } from '@/lib/intervalPlan'
import {
  primeAudio,
  say,
  speechSupported,
  stopSpeaking,
  tone,
  type Cue,
  type SoundSettings,
} from '@/lib/speech'
import { useIntervalTimer } from '@/lib/useIntervalTimer'
import { cn } from '@/lib/utils'
import { PHASE_LABELS, type Phase, type TimerConfig } from '@/types/timer'

/** Work reads as the loud state; every kind of rest shares the quiet one. */
function palette(phase: Phase | null) {
  if (!phase) return { card: 'border-border', accent: 'text-foreground' }
  if (phase.kind === 'WORK') {
    return { card: 'border-primary/50 bg-primary/5', accent: 'text-primary' }
  }
  if (phase.kind === 'WARMUP' || phase.kind === 'COOLDOWN') {
    return { card: 'border-border bg-muted/40', accent: 'text-muted-foreground' }
  }
  return { card: 'border-border bg-muted/60', accent: 'text-muted-foreground' }
}

/** What the voice says when a phase begins. The countdown before it is just 3, 2, 1. */
function entryCue(phase: Phase): string {
  if (phase.kind === 'WORK') return `Start. ${phase.label}`
  if (phase.kind === 'WARMUP') return 'Warm up'
  if (phase.kind === 'COOLDOWN') return 'Cool down. Rest easy.'
  return 'Rest easy'
}

/** Spelled out: engines read a bare digit inconsistently, and "1" often clips to a blip. */
const COUNT_WORDS: Record<number, string> = { 3: 'Three', 2: 'Two', 1: 'One' }

export function IntervalRunner({
  config,
  sound: settings,
  autoStart = false,
  onExit,
}: {
  config: TimerConfig
  sound: SoundSettings
  /** Set when the click that mounted this was itself the Start button. */
  autoStart?: boolean
  onExit: () => void
}) {
  const [sound, setSound] = useState(true)
  // The cue callbacks are handed to the timer once and then live inside its interval,
  // so they read these through a ref instead of closing over stale values.
  const soundRef = useRef(true)
  const settingsRef = useRef(settings)
  useEffect(() => {
    soundRef.current = sound
    settingsRef.current = settings
  }, [sound, settings])

  // Frozen for the length of the session: rebuilding it from an edit made mid-workout
  // would move every phase boundary under the running clock.
  const plan = useMemo(() => buildPlan(config), [config])

  /**
   * The beep goes first and the words follow it.
   *
   * Speech synthesis has no volume above 1, so the tone is what carries the cue across a
   * room; the voice is there to say which exercise it was.
   */
  const cue = useCallback((sounded: Cue, text: string) => {
    if (!soundRef.current) return
    tone(sounded, settingsRef.current.beeps)
    say(text, settingsRef.current)
  }, [])

  const timer = useIntervalTimer(plan, {
    onCount: useCallback(
      (secondsLeft: number) => cue('tick', COUNT_WORDS[secondsLeft] ?? String(secondsLeft)),
      [cue],
    ),
    onEnter: useCallback(
      (phase: Phase) => cue(phase.kind === 'WORK' ? 'work' : 'rest', entryCue(phase)),
      [cue],
    ),
    onFinish: useCallback(() => cue('finish', 'Session complete. Well done.'), [cue]),
  })

  const { phase, nextPhase, secondsLeft, status } = timer
  const running = status === 'RUNNING'
  const finished = status === 'FINISHED'
  const colors = palette(phase)

  const phaseElapsed = phase ? phase.seconds - secondsLeft : 0
  const roundsAfterThis = phase?.round && phase.rounds ? phase.rounds - phase.round : 0
  const exercisesLeft =
    phase?.exercise && phase.exercises ? phase.exercises - phase.exercise : null

  function begin() {
    // Must happen inside the click, before any cue — see the note in speech.ts.
    if (sound) primeAudio()
    timer.start()
  }

  // Mounted by the Start button on the setup screen, so the clock runs from the click
  // rather than making anyone press Start twice. The ref survives StrictMode's second
  // pass, which would otherwise restart a session already a few seconds in.
  const started = useRef(false)
  const start = timer.start
  useEffect(() => {
    if (!autoStart || started.current) return
    started.current = true
    start()
  }, [autoStart, start])

  function stop() {
    stopSpeaking()
    timer.reset()
    onExit()
  }

  return (
    <div className="space-y-4">
      <Card className={cn('transition-colors', colors.card)}>
        <CardContent className="space-y-6 py-8">
          <div className="flex items-center justify-between gap-3">
            <Badge variant={phase?.kind === 'WORK' ? 'default' : 'secondary'}>
              {finished ? 'Finished' : PHASE_LABELS[phase?.kind ?? 'WARMUP']}
            </Badge>
            <div className="flex items-center gap-2">
              <span className="text-xs tabular-nums text-muted-foreground">
                {mmss(timer.remaining)} left
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={sound ? 'Mute the cues' : 'Unmute the cues'}
                onClick={() => {
                  if (sound) stopSpeaking()
                  setSound((on) => !on)
                }}
              >
                {sound ? (
                  <Volume2 className="size-4" />
                ) : (
                  <VolumeX className="size-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="text-center">
            <div
              className={cn(
                'text-7xl font-semibold tabular-nums leading-none sm:text-8xl',
                colors.accent,
              )}
            >
              {finished ? '0' : secondsLeft}
            </div>
            <p className="mt-3 min-h-6 text-lg font-medium" aria-live="polite">
              {finished ? 'Session complete' : phase?.label}
            </p>
            {!finished && nextPhase && (
              <p className="mt-1 text-sm text-muted-foreground">
                Up next: {nextPhase.kind === 'WORK' ? nextPhase.label : PHASE_LABELS[nextPhase.kind]}
                {' · '}
                {nextPhase.seconds}s
              </p>
            )}
          </div>

          <Progress
            value={phase && phase.seconds > 0 ? (phaseElapsed / phase.seconds) * 100 : 100}
            aria-label="Time through this interval"
          />

          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat
              label="Group"
              value={
                phase?.groupIndex != null ? `${phase.groupIndex + 1} of ${config.groups.length}` : '—'
              }
              hint={phase?.groupName ?? undefined}
            />
            <Stat
              label="Round"
              value={phase?.round ? `${phase.round} of ${phase.rounds}` : '—'}
              hint={
                phase?.round
                  ? roundsAfterThis > 0
                    ? `${roundsAfterThis} more after this`
                    : 'last round'
                  : undefined
              }
            />
            <Stat
              label="Exercise"
              value={phase?.exercise ? `${phase.exercise} of ${phase.exercises}` : '—'}
              hint={
                exercisesLeft != null
                  ? exercisesLeft > 0
                    ? `${exercisesLeft} left this round`
                    : 'last of the round'
                  : undefined
              }
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Session</span>
          <span className="tabular-nums">
            {mmss(timer.elapsed)} / {mmss(plan.totalSeconds)}
          </span>
        </div>
        <Progress
          value={plan.totalSeconds > 0 ? (timer.elapsed / plan.totalSeconds) * 100 : 0}
          aria-label="Time through the whole session"
        />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {status === 'IDLE' && (
          <Button size="lg" className="gap-2" onClick={begin}>
            <Play className="size-5" />
            Start
          </Button>
        )}

        {(running || status === 'PAUSED') && (
          <>
            <Button variant="outline" size="lg" className="gap-2" onClick={timer.back}>
              <SkipBack className="size-4" />
              Back
            </Button>
            <Button
              size="lg"
              className="gap-2"
              onClick={() => {
                if (running) {
                  stopSpeaking()
                  timer.pause()
                } else {
                  timer.resume()
                }
              }}
            >
              {running ? <Pause className="size-5" /> : <Play className="size-5" />}
              {running ? 'Pause' : 'Resume'}
            </Button>
            <Button variant="outline" size="lg" className="gap-2" onClick={timer.skip}>
              <SkipForward className="size-4" />
              Skip
            </Button>
          </>
        )}

        {finished && (
          <Button size="lg" className="gap-2" onClick={begin}>
            <RotateCcw className="size-4" />
            Go again
          </Button>
        )}

        {status !== 'IDLE' && (
          <Button variant="ghost" size="lg" className="gap-2" onClick={stop}>
            <Square className="size-4" />
            {finished ? 'Done' : 'Stop'}
          </Button>
        )}

        {status === 'IDLE' && (
          <Button variant="ghost" size="lg" onClick={onExit}>
            Edit intervals
          </Button>
        )}
      </div>

      {!speechSupported && (
        <p className="text-center text-xs text-muted-foreground">
          This browser has no speech synthesis, so the countdown beeps without speaking.
        </p>
      )}
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-background/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint ?? ' '}</p>
    </div>
  )
}
