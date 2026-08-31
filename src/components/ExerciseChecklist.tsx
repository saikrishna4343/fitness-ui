import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { useTickExercise } from '@/api/hooks'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { Workout } from '@/types/api'

/**
 * The tickable workout. `showLogging` adds the weight/reps fields used on the full
 * workout page; the dashboard card shows checkboxes only.
 */
export function ExerciseChecklist({
  workout,
  date,
  showLogging = false,
}: {
  workout: Workout
  date: string
  showLogging?: boolean
}) {
  const tick = useTickExercise(date)

  if (workout.restDay) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        Rest day — nothing scheduled. Enjoy it.
      </p>
    )
  }

  if (workout.exercises.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        No exercises on this day yet. Add some from the weekly plan.
      </p>
    )
  }

  return (
    <ul className="divide-y rounded-lg border">
      {workout.exercises.map((exercise) => (
        <li
          key={exercise.id}
          className={cn(
            'flex flex-wrap items-center gap-3 px-3 py-3 transition-colors',
            exercise.completed && 'bg-muted/40',
          )}
        >
          <Checkbox
            id={`exercise-${exercise.id}`}
            checked={exercise.completed}
            onCheckedChange={(checked) =>
              tick.mutate(
                { id: exercise.id, body: { completed: checked === true } },
                { onError: (error) => toast.error(error.message) },
              )
            }
          />

          <Label
            htmlFor={`exercise-${exercise.id}`}
            className={cn(
              'flex-1 cursor-pointer flex-col items-start gap-0.5 font-normal',
              exercise.completed && 'text-muted-foreground line-through',
            )}
          >
            <span className="text-sm font-medium">{exercise.name}</span>
            <span className="text-xs text-muted-foreground">
              {exercise.targetSets} x {exercise.targetReps}
              {exercise.targetWeightKg != null && ` @ ${exercise.targetWeightKg} kg`}
            </span>
          </Label>

          {showLogging ? (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                step="0.5"
                className="h-8 w-24"
                placeholder="kg"
                defaultValue={exercise.actualWeightKg ?? ''}
                aria-label={`Weight used for ${exercise.name}`}
                onBlur={(event) => {
                  const raw = event.target.value
                  const next = raw === '' ? null : Number(raw)
                  if (next !== (exercise.actualWeightKg ?? null)) {
                    tick.mutate({ id: exercise.id, body: { actualWeightKg: next } })
                  }
                }}
              />
              <Input
                className="h-8 w-28"
                placeholder="reps done"
                defaultValue={exercise.actualReps ?? ''}
                aria-label={`Reps done for ${exercise.name}`}
                onBlur={(event) => {
                  const next = event.target.value || null
                  if (next !== (exercise.actualReps ?? null)) {
                    tick.mutate({ id: exercise.id, body: { actualReps: next } })
                  }
                }}
              />
            </div>
          ) : (
            exercise.completed && (
              <Badge variant="secondary" className="gap-1">
                <Check className="size-3" />
                Done
              </Badge>
            )
          )}
        </li>
      ))}
    </ul>
  )
}
