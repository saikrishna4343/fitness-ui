import { CheckCircle2, Dumbbell } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { assignToGroup, groupOf } from '@/lib/timerWorkout'
import { cn } from '@/lib/utils'
import type { Workout } from '@/types/api'
import type { TimerConfig } from '@/types/timer'

/** The value the Select uses for "leave this one out". */
const OUT = 'out'

/**
 * Today's workout, exercise by exercise, with the group each one runs in.
 *
 * The timer used to drop the whole day into a single group, which is only right for a
 * workout that happens to be one circuit. A real session is a couple of blocks — the
 * heavy work, then the accessories — so the assignment is the thing to put on screen,
 * and the groups below are what it assigns into.
 *
 * Exercises already ticked on the workout are shown as done rather than hidden: the
 * list should match what the Workout screen says, and a finished exercise is still
 * part of today.
 */
export function TodaysExercises({
  workout,
  config,
  onChange,
}: {
  workout: Workout
  config: TimerConfig
  onChange: (config: TimerConfig) => void
}) {
  if (workout.exercises.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-5 text-sm text-muted-foreground">
          <Dumbbell className="size-4 shrink-0" />
          Nothing planned for today. Anything you build below is added to today&apos;s workout
          when you start.
        </CardContent>
      </Card>
    )
  }

  const inSession = workout.exercises.filter((exercise) => groupOf(config, exercise.id)).length

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
        <div>
          <h2 className="text-base font-semibold">Today&apos;s workout</h2>
          <p className="text-sm text-muted-foreground">
            {workout.focus} — put each exercise in a group, or leave it out.
          </p>
        </div>
        <Badge variant="secondary">
          {inSession} of {workout.exercises.length} in this session
        </Badge>
      </CardHeader>

      <CardContent className="space-y-2">
        {workout.exercises.map((exercise) => {
          const group = groupOf(config, exercise.id)
          const interval = group?.exercises.find((e) => e.sessionExerciseId === exercise.id)

          return (
            <div
              key={exercise.id}
              className={cn(
                'flex flex-wrap items-center gap-3 rounded-md border p-2.5',
                !group && 'border-dashed opacity-70',
              )}
            >
              {exercise.completed ? (
                <CheckCircle2 className="size-4 shrink-0 text-primary" aria-label="Completed" />
              ) : (
                <span className="size-4 shrink-0 rounded-full border" aria-hidden />
              )}

              <div className="min-w-40 flex-1">
                <p className={cn('truncate text-sm font-medium', exercise.completed && 'line-through')}>
                  {exercise.name}
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {interval
                    ? `${interval.sets} × ${interval.seconds}s`
                    : `${exercise.targetSets} × ${exercise.targetReps}`}
                </p>
              </div>

              <Select
                value={group?.id ?? OUT}
                onValueChange={(value) =>
                  onChange(assignToGroup(config, exercise.id, value === OUT ? null : value, exercise))
                }
              >
                <SelectTrigger className="w-44" aria-label={`Group for ${exercise.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {config.groups.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={OUT}>Not in this session</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )
        })}

        <p className="pt-1 text-xs text-muted-foreground">
          Set the seconds for each one in its group below. Finishing an exercise&apos;s last set
          ticks it off on the Workout screen.
        </p>
      </CardContent>
    </Card>
  )
}
