import {
  CheckCircle2,
  Plus,
  RotateCcw,
  SkipForward,
  Timer as TimerIcon,
  Undo2,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  useCompleteWorkout,
  useReloadWorkoutFromPlan,
  useReopenWorkout,
  useSkipWorkout,
  useUpdateWorkout,
  useWorkout,
} from '@/api/hooks'
import { PageHeader } from '@/components/AppShell'
import { DatePicker } from '@/components/DatePicker'
import { ExerciseChecklist } from '@/components/ExerciseChecklist'
import { SessionExerciseDialog } from '@/components/SessionExerciseDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { percent, toIsoDate } from '@/lib/format'
import type { WorkoutStatus } from '@/types/api'

const STATUS_LABELS: Record<WorkoutStatus, string> = {
  PLANNED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  SKIPPED: 'Skipped',
}

export default function Workout() {
  const [date, setDate] = useState(new Date())
  const [addOpen, setAddOpen] = useState(false)
  const isoDate = toIsoDate(date)

  const { data: workout, isLoading } = useWorkout(isoDate)
  const complete = useCompleteWorkout(isoDate)
  const skip = useSkipWorkout(isoDate)
  const update = useUpdateWorkout(isoDate)
  const reload = useReloadWorkoutFromPlan(isoDate)
  const reopen = useReopenWorkout(isoDate)

  function toggleRestDay(restDay: boolean) {
    if (!workout) return
    update.mutate(
      {
        id: workout.id,
        // Leaving the focus as "Rest" on a training day reads as a bug, so it moves with
        // the toggle. The user can rename it from the weekly plan.
        body: { restDay, focus: restDay ? 'Rest' : 'Training' },
      },
      {
        onSuccess: () => toast.success(restDay ? 'Marked as a rest day' : 'Rest day cancelled'),
        onError: (error) => toast.error(error.message),
      },
    )
  }

  return (
    <>
      <PageHeader
        title="Workout"
        description="Tick each exercise as you finish it, and record what you actually lifted."
        actions={<DatePicker value={date} onChange={setDate} />}
      />

      {isLoading || !workout ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle>{workout.focus}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{workout.dayName}</p>
            </div>
            <Badge variant={workout.status === 'COMPLETED' ? 'default' : 'secondary'}>
              {STATUS_LABELS[workout.status]}
            </Badge>
          </CardHeader>

          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <div className="flex items-center gap-3">
                <Switch
                  id="rest-day"
                  checked={workout.restDay}
                  disabled={update.isPending}
                  onCheckedChange={toggleRestDay}
                />
                <div>
                  <Label htmlFor="rest-day" className="cursor-pointer">
                    Rest day
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {workout.restDay
                      ? 'Turn this off to train today.'
                      : 'Training day — add exercises below.'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={reload.isPending}
                  onClick={() =>
                    reload.mutate(workout.id, {
                      onSuccess: () => toast.success('Loaded from your weekly plan'),
                      onError: (error) => toast.error(error.message),
                    })
                  }
                >
                  <RotateCcw className="size-4" />
                  Load from plan
                </Button>
                <Button variant="outline" size="sm" className="gap-2" asChild>
                  <Link to="/timer">
                    <TimerIcon className="size-4" />
                    Interval timer
                  </Link>
                </Button>
                <Button size="sm" className="gap-2" onClick={() => setAddOpen(true)}>
                  <Plus className="size-4" />
                  Add exercise
                </Button>
              </div>
            </div>

            {!workout.restDay && workout.totalCount > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="tabular-nums font-medium">
                    {workout.completedCount} of {workout.totalCount}
                  </span>
                </div>
                <Progress value={percent(workout.completedCount, workout.totalCount)} />
              </div>
            )}

            <ExerciseChecklist workout={workout} date={isoDate} showLogging editable />

            {!workout.restDay && workout.totalCount > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button
                  className="gap-2"
                  disabled={workout.status === 'COMPLETED' || complete.isPending}
                  onClick={() =>
                    complete.mutate(workout.id, {
                      onSuccess: () => toast.success('Workout complete. Nice one.'),
                      onError: (error) => toast.error(error.message),
                    })
                  }
                >
                  <CheckCircle2 className="size-4" />
                  Mark workout complete
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  disabled={workout.status === 'SKIPPED' || skip.isPending}
                  onClick={() =>
                    skip.mutate(workout.id, {
                      onSuccess: () => toast('Workout skipped'),
                      onError: (error) => toast.error(error.message),
                    })
                  }
                >
                  <SkipForward className="size-4" />
                  Skip today
                </Button>
                {(workout.status === 'COMPLETED' || workout.status === 'SKIPPED') && (
                  <Button
                    variant="ghost"
                    className="gap-2"
                    disabled={reopen.isPending}
                    onClick={() =>
                      reopen.mutate(workout.id, {
                        onSuccess: () => toast('Workout reopened'),
                        onError: (error) => toast.error(error.message),
                      })
                    }
                  >
                    <Undo2 className="size-4" />
                    Reopen
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {workout && (
        <SessionExerciseDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          workoutId={workout.id}
          date={isoDate}
        />
      )}
    </>
  )
}
