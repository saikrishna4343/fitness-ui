import { Download, Play, RotateCcw, Timer as TimerIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useWorkout } from '@/api/hooks'
import { PageHeader } from '@/components/AppShell'
import { IntervalPlanEditor } from '@/components/IntervalPlanEditor'
import { IntervalRunner } from '@/components/IntervalRunner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { toIsoDate } from '@/lib/format'
import { buildPlan, countWork, mmss } from '@/lib/intervalPlan'
import { unlockSpeech } from '@/lib/speech'
import { defaultConfig, loadConfig, newExercise, newId, saveConfig } from '@/lib/timerStorage'
import type { TimerConfig } from '@/types/timer'

export default function Timer() {
  // Read once, on the first render: a later read would fight whatever is being typed.
  const [config, setConfig] = useState<TimerConfig>(loadConfig)
  const [running, setRunning] = useState(false)

  useEffect(() => saveConfig(config), [config])

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

  if (running) {
    return (
      <>
        <PageHeader title="Interval timer" description="Eyes off the screen — the voice calls it." />
        <IntervalRunner config={config} autoStart onExit={() => setRunning(false)} />
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
                onClick={() => {
                  // Inside the click, so iOS lets the first countdown speak.
                  unlockSpeech()
                  setRunning(true)
                }}
              >
                <Play className="size-5" />
                Start workout
              </Button>
            </div>
          </CardContent>
        </Card>

        {empty && (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Add at least one exercise to a group before starting.
          </p>
        )}

        <IntervalPlanEditor config={config} onChange={setConfig} />
      </div>
    </>
  )
}
