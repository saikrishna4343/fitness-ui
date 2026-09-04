import { Download, History, Play, RotateCcw, Timer as TimerIcon, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useWorkout } from '@/api/hooks'
import { PageHeader } from '@/components/AppShell'
import { IntervalPlanEditor } from '@/components/IntervalPlanEditor'
import { IntervalRunner } from '@/components/IntervalRunner'
import { SoundSettingsCard } from '@/components/SoundSettingsCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { toIsoDate } from '@/lib/format'
import { buildPlan, countWork, mmss, phaseIndexAt } from '@/lib/intervalPlan'
import { primeAudio, type SoundSettings } from '@/lib/speech'
import {
  clearSession,
  defaultConfig,
  loadConfig,
  loadSession,
  loadSound,
  newExercise,
  newId,
  saveConfig,
  saveSound,
} from '@/lib/timerStorage'
import type { SavedSession } from '@/lib/timerStorage'
import type { TimerConfig } from '@/types/timer'

export default function Timer() {
  // Read once, on the first render: a later read would fight whatever is being typed.
  const [config, setConfig] = useState<TimerConfig>(loadConfig)
  const [sound, setSound] = useState<SoundSettings>(loadSound)
  const [running, setRunning] = useState(false)
  // Read once, before anything can overwrite it: the runner starts saving over this
  // snapshot the moment a session begins.
  const [unfinished, setUnfinished] = useState(loadSession)
  const [resumeAt, setResumeAt] = useState(0)

  useEffect(() => saveConfig(config), [config])
  useEffect(() => saveSound(sound), [sound])

  const today = toIsoDate(new Date())
  const { data: workout } = useWorkout(today)

  const plan = useMemo(() => buildPlan(config), [config])
  const totals = countWork(config)
  const empty = plan.totalSeconds === 0

  function loadFromWorkout() {
    if (!workout || workout.exercises.length === 0) return
    setConfig({
      ...config,
      groups: [
        ...config.groups,
        {
          id: newId(),
          name: workout.focus || 'Today',
          rounds: 3,
          restSeconds: 20,
          roundRestSeconds: 60,
          // Only the names carry over. Today's workout is measured in sets and reps,
          // which say nothing about how long an interval should run, so every one
          // starts at the same default for you to trim.
          exercises: workout.exercises.map((exercise) => newExercise(exercise.name)),
        },
      ],
    })
    toast.success(`Added ${workout.exercises.length} exercises from today's workout`)
  }

  function begin(from = 0) {
    // Inside the click, so iOS lets the first countdown play.
    primeAudio()
    // Whatever was offered is about to be written over by the session starting now.
    setUnfinished(null)
    setResumeAt(from)
    setRunning(true)
  }

  function discard() {
    clearSession()
    setUnfinished(null)
  }

  function resume() {
    if (!unfinished) return
    // The session runs the config it started with, which is not necessarily the one in
    // the editor now — so that becomes the editor's config too, rather than leaving the
    // screen describing a workout other than the one counting down.
    setConfig(unfinished.config)
    setUnfinished(null)
    begin(unfinished.elapsed)
  }

  if (running) {
    return (
      <>
        <PageHeader title="Interval timer" description="Eyes off the screen — the voice calls it." />
        <IntervalRunner
          config={config}
          sound={sound}
          autoStart
          resumeAt={resumeAt}
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
                  {totals.rounds} {totals.rounds === 1 ? 'round' : 'rounds'} · {totals.exercises}{' '}
                  intervals
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {workout && workout.exercises.length > 0 && (
                <Button variant="outline" className="gap-2" onClick={loadFromWorkout}>
                  <Download className="size-4" />
                  Use today&apos;s exercises
                </Button>
              )}
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
                disabled={empty}
                onClick={() => begin()}
              >
                <Play className="size-5" />
                Start workout
              </Button>
            </div>
          </CardContent>
        </Card>

        {unfinished && <ResumeCard session={unfinished} onResume={resume} onDiscard={discard} />}

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
              {phase?.round ? ` · round ${phase.round} of ${phase.rounds}` : ''} ·{' '}
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
            <Play className="size-4" />
            Resume
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
