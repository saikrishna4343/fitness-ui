import { Check, Dumbbell, History, Play, RotateCcw, Timer as TimerIcon, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  useAddSessionExercise,
  useCompleteWorkout,
  useTickExercise,
  useUpdateWorkout,
  useWorkout,
} from '@/api/hooks'
import { PageHeader } from '@/components/AppShell'
import { IntervalPlanEditor } from '@/components/IntervalPlanEditor'
import { IntervalRunner } from '@/components/IntervalRunner'
import { SoundSettingsCard } from '@/components/SoundSettingsCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toIsoDate } from '@/lib/format'
import { buildPlan, countWork, mmss, phaseIndexAt } from '@/lib/intervalPlan'
import { primeAudio, type SoundSettings } from '@/lib/speech'
import {
  clearSession,
  defaultConfig,
  loadConfig,
  loadSession,
  loadSound,
  saveConfig,
  saveSound,
  type SavedSession,
} from '@/lib/timerStorage'
import {
  findWorkoutGroup,
  repsFromSeconds,
  syncFromWorkout,
  withSessionIds,
} from '@/lib/timerWorkout'
import type { Phase, TimerConfig } from '@/types/timer'

export default function Timer() {
  // Read once, on the first render: a later read would fight whatever is being typed.
  const [stored, setStored] = useState<TimerConfig>(loadConfig)
  const [sound, setSound] = useState<SoundSettings>(loadSound)
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  // Read before anything can overwrite it: the runner starts saving over this
  // snapshot the moment a session begins.
  const [unfinished, setUnfinished] = useState(loadSession)
  const [resumeAt, setResumeAt] = useState(0)
  const [linkedWorkoutId, setLinkedWorkoutId] = useState<string | null>(null)
  /**
   * The config the running session was started with.
   *
   * Held apart from `config` because starting can write session ids into it, and the
   * runner must be handed the version that has them -- otherwise the plan it freezes
   * has nothing to tick against.
   */
  const [runConfig, setRunConfig] = useState<TimerConfig | null>(null)

  useEffect(() => saveSound(sound), [sound])

  const today = toIsoDate(new Date())
  const { data: workout } = useWorkout(today)
  const addExercise = useAddSessionExercise(today)
  const updateWorkout = useUpdateWorkout(today)
  const tickExercise = useTickExercise(today)
  const completeWorkout = useCompleteWorkout(today)

  /**
   * Today's workout, folded in.
   *
   * Derived rather than copied on a button press: the two screens are meant to be one
   * workout, so an exercise added over there has to be here without anyone asking.
   * Doing it in a memo rather than an effect means there is no second render and no
   * state to fall out of step -- the config simply *is* the merge.
   *
   * `syncFromWorkout` keeps whatever you set here, matched by session id, so this
   * running on every render costs nothing and changes nothing once it has settled.
   */
  const config = useMemo(
    () => (stored.syncWithWorkout && workout ? syncFromWorkout(stored, workout) : stored),
    [stored, workout],
  )

  // The merged config is what gets saved, so the session ids survive a reload.
  useEffect(() => saveConfig(config), [config])

  const setConfig = setStored

  const plan = useMemo(() => buildPlan(config), [config])
  const totals = countWork(config)
  const empty = plan.totalSeconds === 0
  const linked = findWorkoutGroup(config)

  /**
   * Pushes anything the timer has that the workout does not, and returns the config
   * with the new ids written in.
   *
   * Awaited before the clock starts, deliberately. The runner freezes its plan at
   * mount, so an id arriving a second later would arrive too late to ever be ticked.
   * In the common case -- a session loaded from the workout -- there is nothing to
   * push and this returns immediately.
   */
  async function pushToWorkout(): Promise<TimerConfig> {
    if (!config.syncWithWorkout || !workout) return config

    const missing = config.groups.flatMap((group) =>
      group.exercises
        .filter((exercise) => !exercise.sessionExerciseId)
        .map((exercise) => ({
          exercise,
          // A circuit's rounds are its sets; in straight sets each exercise has its own.
          sets: group.style === 'SETS' ? exercise.sets : group.rounds,
        })),
    )
    if (missing.length === 0) return config

    const ids = new Map<string, string>()
    try {
      if (workout.restDay) {
        // A rest day holding exercises reads as a bug on the Workout screen, so the
        // flag moves with them.
        await updateWorkout.mutateAsync({
          id: workout.id,
          body: { restDay: false, focus: workout.focus === 'Rest' ? 'Training' : workout.focus },
        })
      }

      // Sequential: add_session_exercise assigns order_index from what is already
      // there, so racing these would shuffle them against the order you built.
      for (const { exercise, sets } of missing) {
        const row = (await addExercise.mutateAsync({
          id: workout.id,
          body: {
            name: exercise.name.trim() || 'Exercise',
            targetSets: sets,
            // Seconds, not reps: it is what this exercise actually is here, and
            // reading it back is what stops a round trip resetting your timings.
            targetReps: repsFromSeconds(exercise.seconds),
          },
        })) as { id: string }
        ids.set(exercise.id, row.id)
      }
      toast.success(`Added ${missing.length} to today's workout`)
    } catch (error) {
      // A failure here is not a reason to refuse to run the timer.
      toast.error(error instanceof Error ? error.message : 'Could not update the workout')
    }

    const next = withSessionIds(config, ids)
    setConfig(next)
    return next
  }

  async function begin() {
    // Inside the click, before any await, so iOS lets the first countdown play.
    primeAudio()
    setUnfinished(null)
    setResumeAt(0)

    setStarting(true)
    const next = await pushToWorkout()
    setStarting(false)

    setRunConfig(next)
    setLinkedWorkoutId(config.syncWithWorkout ? (workout?.id ?? null) : null)
    setRunning(true)
  }

  function resume() {
    if (!unfinished) return
    primeAudio()
    setConfig(unfinished.config)
    setRunConfig(unfinished.config)
    setLinkedWorkoutId(unfinished.linkedWorkoutId)
    setUnfinished(null)
    setResumeAt(unfinished.elapsed)
    setRunning(true)
  }

  function discard() {
    clearSession()
    setUnfinished(null)
  }

  /** An exercise finished its last set. Tick it where it counts. */
  function exerciseDone(phase: Phase) {
    if (!phase.sessionExerciseId || !linkedWorkoutId) return
    tickExercise.mutate({
      id: phase.sessionExerciseId,
      body: { completed: true, actualReps: repsFromSeconds(phase.seconds) },
    })
  }

  /**
   * The session ran to the end.
   *
   * The workout is marked complete only when the timer actually covered all of it. A
   * ten-minute circuit alongside a planned eight-lift day has not done those lifts,
   * and saying otherwise would be a lie that the Progress screen then repeats.
   */
  function finished() {
    if (!linkedWorkoutId || !workout) return

    const covered = new Set(
      (runConfig ?? config).groups.flatMap((group) =>
        group.exercises.map((exercise) => exercise.sessionExerciseId),
      ),
    )
    if (!workout.exercises.every((exercise) => covered.has(exercise.id))) return

    completeWorkout.mutate(linkedWorkoutId, {
      onSuccess: () => toast.success("Today's workout is complete"),
      onError: (error) => toast.error(error.message),
    })
  }

  if (running) {
    return (
      <>
        <PageHeader title="Interval timer" description="Eyes off the screen — the voice calls it." />
        <IntervalRunner
          config={runConfig ?? config}
          sound={sound}
          autoStart
          resumeAt={resumeAt}
          linkedWorkoutId={linkedWorkoutId}
          onExerciseDone={exerciseDone}
          onFinished={finished}
          onExit={() => setRunning(false)}
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Interval timer"
        description="Build groups of exercises, set the work and rest, and let it count you through."
      />

      <div className="space-y-4">
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
            <div className="flex items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <TimerIcon className="size-5" />
              </span>
              <div>
                <p className="text-2xl font-semibold tabular-nums leading-tight">
                  {mmss(plan.totalSeconds)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {config.groups.length} {config.groups.length === 1 ? 'group' : 'groups'} ·{' '}
                  {totals.exercises} intervals
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                className="gap-2 text-muted-foreground"
                onClick={() => setConfig(defaultConfig())}
              >
                <RotateCcw className="size-4" />
                Reset
              </Button>
              <Button
                size="lg"
                className="gap-2"
                disabled={empty || starting}
                onClick={() => void begin()}
              >
                <Play className="size-5" />
                {starting ? 'Getting ready…' : 'Start workout'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {unfinished && <ResumeCard session={unfinished} onResume={resume} onDiscard={discard} />}

        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                <Dumbbell className="size-4" />
              </span>
              <div>
                <Label htmlFor="sync" className="cursor-pointer">
                  Keep today&apos;s workout in step
                </Label>
                <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">
                  {linked
                    ? `The ${linked.exercises.length} exercises on today are below, with their sets — set the seconds for each. Add or remove them on the Workout screen. Finishing an exercise's last set ticks it there.`
                    : 'Exercises here are added to today’s workout, and ticked off as you finish their last set. Turn it off for a session you would rather not log.'}
                </p>
              </div>
            </div>

            <Switch
              id="sync"
              checked={config.syncWithWorkout}
              onCheckedChange={(syncWithWorkout) => setConfig({ ...config, syncWithWorkout })}
            />
          </CardContent>
        </Card>

        {empty && (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Add at least one exercise to a group before starting.
          </p>
        )}

        <SoundSettingsCard settings={sound} onChange={setSound} />

        <IntervalPlanEditor config={config} onChange={setConfig} />
      </div>
    </>
  )
}

/** Offered after a reload or a closed tab, with enough detail to recognise the session. */
function ResumeCard({
  session,
  onResume,
  onDiscard,
}: {
  session: SavedSession
  onResume: () => void
  onDiscard: () => void
}) {
  const plan = buildPlan(session.config)
  const phase = plan.phases[phaseIndexAt(plan.phases, session.elapsed)]

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <History className="size-5" />
          </span>
          <div>
            <p className="font-medium">Pick up where you left off</p>
            <p className="text-sm text-muted-foreground">
              {phase?.label ?? 'In progress'}
              {phase?.round ? ` · ${phase.round} of ${phase.rounds}` : ''} ·{' '}
              {mmss(session.elapsed)} in, {mmss(plan.totalSeconds - session.elapsed)} to go
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" className="gap-2 text-muted-foreground" onClick={onDiscard}>
            <X className="size-4" />
            Discard
          </Button>
          <Button className="gap-2" onClick={onResume}>
            <Check className="size-4" />
            Resume
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
