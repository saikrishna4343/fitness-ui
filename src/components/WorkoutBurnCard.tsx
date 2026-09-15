import { Flame } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useDailySummary, useUpdateWorkout } from '@/api/hooks'
import { BurnGoalLine } from '@/components/EnergyBalance'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { kcal, percent } from '@/lib/format'
import type { BurnSource, Workout } from '@/types/api'

/**
 * Calories burned by one day's workout: the number the dashboard adds back to the
 * day's budget.
 *
 * Two optional inputs, and they do different things. A calorie count (read off a
 * watch) replaces the estimate outright. A duration keeps the estimate but makes it
 * better -- without one, daily_summary() has only the ticked sets to go on. The
 * estimate itself is computed in Postgres, never here, so this card, the dashboard
 * and the coach all read the same number.
 */
export function WorkoutBurnCard({ workout, date }: { workout: Workout; date: string }) {
  const { data: summary } = useDailySummary(date)
  const update = useUpdateWorkout(date)

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Flame className="size-4 text-chart-4" />
            Calories burned
          </CardTitle>
          <CardDescription className="mt-1">
            Added back to the day&apos;s calorie budget on the dashboard.
          </CardDescription>
        </div>
        {summary && summary.burnSource !== 'NONE' && (
          <Badge variant="secondary">
            {summary.burnSource === 'LOGGED' ? 'Logged' : 'Estimated'}
          </Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-5">
        {!summary ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="space-y-2">
            <p className="text-3xl font-semibold tabular-nums tracking-tight">
              {kcal(summary.caloriesBurned)}
              <span className="ml-1 text-sm font-normal text-muted-foreground">kcal</span>
            </p>
            {summary.burnGoal > 0 && (
              <Progress
                value={percent(summary.caloriesBurned, summary.burnGoal)}
                className="bg-muted [&>[data-slot=progress-indicator]]:bg-chart-4"
                aria-label="Calories burned against the burn target"
              />
            )}
            <BurnGoalLine summary={summary} />
            <p className="text-xs text-muted-foreground">{explain(summary.burnSource, summary.estimatedBurn, workout)}</p>
          </div>
        )}

        {/* Keyed on the saved values, so a save or a date change resets the drafts
            to what the server now holds. */}
        <BurnForm
          key={`${workout.id}:${workout.caloriesBurned}:${workout.durationMinutes}`}
          workout={workout}
          estimate={summary?.estimatedBurn}
          pending={update.isPending}
          onSave={(body, message) =>
            update.mutate(
              { id: workout.id, body },
              {
                onSuccess: () => toast.success(message),
                onError: (error) => toast.error(error.message),
              },
            )
          }
        />
      </CardContent>
    </Card>
  )
}

function explain(source: BurnSource, estimate: number, workout: Workout): string {
  if (source === 'LOGGED') {
    return estimate > 0 ? `Your number. The estimate would be ${kcal(estimate)} kcal.` : 'Your number.'
  }
  if (source === 'ESTIMATED') {
    return workout.durationMinutes
      ? `Estimated from ${workout.durationMinutes} minutes of training and your body weight.`
      : 'Estimated from the sets you ticked and your body weight. Add the duration for a closer number.'
  }
  return workout.restDay
    ? 'Nothing logged. Did a walk or a class? Enter it below.'
    : 'Tick exercises as you finish them and the estimate builds up here.'
}

function BurnForm({
  workout,
  estimate,
  pending,
  onSave,
}: {
  workout: Workout
  estimate: number | undefined
  pending: boolean
  onSave: (
    body: { caloriesBurned: number | null; durationMinutes: number | null },
    message: string,
  ) => void
}) {
  const [calories, setCalories] = useState(workout.caloriesBurned?.toString() ?? '')
  const [minutes, setMinutes] = useState(workout.durationMinutes?.toString() ?? '')

  const parsedCalories = parse(calories, 0, 10000)
  const parsedMinutes = parse(minutes, 1, 1440)
  const invalid = parsedCalories === undefined || parsedMinutes === undefined
  const dirty =
    parsedCalories !== workout.caloriesBurned || parsedMinutes !== workout.durationMinutes

  function submit(event: FormEvent) {
    event.preventDefault()
    if (invalid) return
    onSave({ caloriesBurned: parsedCalories, durationMinutes: parsedMinutes }, 'Calories burned saved')
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="burn-minutes">Duration (min)</Label>
          <Input
            id="burn-minutes"
            type="number"
            inputMode="numeric"
            min={1}
            max={1440}
            placeholder="Optional"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="burn-calories">Calories from your watch (kcal)</Label>
          <Input
            id="burn-calories"
            type="number"
            inputMode="numeric"
            min={0}
            max={10000}
            placeholder={estimate ? `Estimate: ${kcal(estimate)}` : 'Optional'}
            value={calories}
            onChange={(event) => setCalories(event.target.value)}
          />
        </div>
      </div>

      {invalid && (
        <p className="text-xs text-destructive">
          Duration must be 1–1440 minutes and calories 0–10,000, in whole numbers.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending || invalid || !dirty}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {workout.caloriesBurned !== null && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              onSave(
                { caloriesBurned: null, durationMinutes: workout.durationMinutes },
                'Using the estimate',
              )
            }
          >
            Use the estimate instead
          </Button>
        )}
      </div>
    </form>
  )
}

/** Blank is null (not set). Anything else must be a whole number in range, or undefined. */
function parse(value: string, min: number, max: number): number | null | undefined {
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined
}
