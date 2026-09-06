import { CheckCircle2, Dumbbell, Split } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  breakIntoGroups,
  DEFAULT_REST_SECONDS,
  groupNumberOf,
  groupOf,
  groupingPending,
  setGroupNumber,
} from '@/lib/timerWorkout'
import { cn } from '@/lib/utils'
import type { Workout } from '@/types/api'
import type { TimerConfig } from '@/types/timer'

/**
 * Today's workout, exercise by exercise, with the group number each one runs in.
 *
 * A number rather than a picker: typing 1, 1, 2, 2 down a column is faster than four
 * dropdowns, and the column then says the shape of the session at a glance. Same
 * number, same group — that is the whole rule.
 *
 * Nothing regroups as you type. The numbers are an intention until you press the
 * button, which means you can renumber the whole list without the session rearranging
 * itself under your hands halfway through.
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

  const pending = groupingPending(config, workout)
  const numbers = workout.exercises.map((exercise) => groupNumberOf(config, exercise.id))
  const distinct = new Set(numbers.filter((n) => n > 0)).size

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
        <div>
          <h2 className="text-base font-semibold">Today&apos;s workout</h2>
          <p className="text-sm text-muted-foreground">
            {workout.focus} — number the exercises, same number for the ones that run together.
            0 leaves one out.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            {distinct} {distinct === 1 ? 'group' : 'groups'}
          </Badge>
          <Button
            size="sm"
            className="gap-2"
            disabled={!pending}
            onClick={() => onChange(breakIntoGroups(config, workout))}
          >
            <Split className="size-4" />
            Break into groups
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Group</TableHead>
                <TableHead>Exercise</TableHead>
                <TableHead className="w-32">Planned</TableHead>
                <TableHead className="w-32">Runs as</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workout.exercises.map((exercise) => {
                const number = groupNumberOf(config, exercise.id)
                const interval = groupOf(config, exercise.id)?.exercises.find(
                  (e) => e.sessionExerciseId === exercise.id,
                )

                return (
                  <TableRow key={exercise.id} className={cn(number === 0 && 'opacity-55')}>
                    <TableCell>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={20}
                        step={1}
                        value={number}
                        aria-label={`Group number for ${exercise.name}`}
                        className="h-9 w-16 tabular-nums"
                        onChange={(event) => {
                          const next = Number(event.target.value)
                          if (event.target.value === '' || Number.isNaN(next)) return
                          onChange(
                            setGroupNumber(config, exercise.id, Math.min(20, Math.max(0, next))),
                          )
                        }}
                      />
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-2">
                        {exercise.completed && (
                          <CheckCircle2 className="size-4 shrink-0 text-primary" aria-label="Done" />
                        )}
                        <span
                          className={cn(
                            'font-medium',
                            exercise.completed && 'text-muted-foreground line-through',
                          )}
                        >
                          {exercise.name}
                        </span>
                      </div>
                    </TableCell>

                    <TableCell className="tabular-nums text-muted-foreground">
                      {exercise.targetSets} × {exercise.targetReps}
                    </TableCell>

                    <TableCell className="tabular-nums">
                      {number === 0 ? (
                        <span className="text-muted-foreground">Left out</span>
                      ) : interval ? (
                        `${interval.sets} × ${interval.seconds}s`
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground">
          {pending
            ? `Break into groups to apply the numbers. New groups start at ${DEFAULT_REST_SECONDS}s rest between sets, exercises and groups — adjust each one below.`
            : "Set the seconds for each exercise in its group below. Finishing an exercise's last set ticks it off on the Workout screen."}
        </p>
      </CardContent>
    </Card>
  )
}
