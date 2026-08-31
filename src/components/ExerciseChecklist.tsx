import { ArrowDown, ArrowUp, Check, GripVertical, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useDeleteSessionExercise, useReorderSessionExercises, useTickExercise } from '@/api/hooks'
import { SessionExerciseDialog } from '@/components/SessionExerciseDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDragReorder } from '@/lib/useDragReorder'
import { cn } from '@/lib/utils'
import type { Workout, WorkoutExercise } from '@/types/api'

/**
 * The tickable workout. `showLogging` adds the weight/reps fields used on the full
 * workout page; the dashboard card shows checkboxes only. `editable` adds the
 * move/edit/delete controls, which the dashboard leaves off -- that card is a
 * glance, and four more buttons per row would bury the checkbox.
 */
export function ExerciseChecklist({
  workout,
  date,
  showLogging = false,
  editable = false,
}: {
  workout: Workout
  date: string
  showLogging?: boolean
  editable?: boolean
}) {
  const tick = useTickExercise(date)
  const remove = useDeleteSessionExercise(date)
  const reorder = useReorderSessionExercises(date)
  const [editingExercise, setEditingExercise] = useState<WorkoutExercise | null>(null)

  const ids = workout.exercises.map((exercise) => exercise.id)

  /**
   * Send the whole id list in its new order. Positions are never sent -- two tabs
   * would disagree about what "index 2" means, an id order cannot.
   */
  function save(nextIds: string[]) {
    reorder.mutate(
      { sessionId: workout.id, exerciseIds: nextIds },
      { onError: (error) => toast.error(error.message) },
    )
  }

  /** The up/down buttons: a plain swap with the neighbour. */
  function move(index: number, direction: -1 | 1) {
    const next = [...ids]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    save(next)
  }

  const drag = useDragReorder(ids, save)

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
    <>
      <ul className="divide-y rounded-lg border">
        {workout.exercises.map((exercise, index) => (
          <li
            key={exercise.id}
            ref={editable ? drag.rowRef(exercise.id) : undefined}
            {...(editable ? drag.rowProps(exercise.id) : {})}
            className={cn(
              'flex flex-wrap items-center gap-3 px-3 py-3 transition-colors',
              exercise.completed && 'bg-muted/40',
              drag.dragging === exercise.id && 'opacity-40',
              // A line on the edge the row will land against, so the drop point is
              // visible before letting go.
              drag.over === exercise.id &&
                (ids.indexOf(drag.dragging ?? '') < index
                  ? 'border-b-2 border-b-primary'
                  : 'border-t-2 border-t-primary'),
            )}
          >
            {editable && (
              <span
                {...drag.handleProps(exercise.id)}
                aria-hidden
                className="-ml-1 cursor-grab text-muted-foreground/50 transition-colors hover:text-muted-foreground active:cursor-grabbing"
              >
                <GripVertical className="size-4" />
              </span>
            )}
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

            {editable && (
              <div className="flex items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={index === 0 || reorder.isPending}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="size-4" />
                  <span className="sr-only">Move {exercise.name} up</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={index === workout.exercises.length - 1 || reorder.isPending}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="size-4" />
                  <span className="sr-only">Move {exercise.name} down</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => setEditingExercise(exercise)}
                >
                  <Pencil className="size-4" />
                  <span className="sr-only">Edit {exercise.name}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(exercise.id, {
                      onSuccess: () => toast.success(`${exercise.name} removed`),
                      onError: (error) => toast.error(error.message),
                    })
                  }
                >
                  <Trash2 className="size-4 text-destructive" />
                  <span className="sr-only">Delete {exercise.name}</span>
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Keyed by id so the form re-initialises when a different exercise is opened. */}
      {editingExercise && (
        <SessionExerciseDialog
          key={editingExercise.id}
          open
          onOpenChange={(next) => !next && setEditingExercise(null)}
          workoutId={workout.id}
          date={date}
          exercise={editingExercise}
        />
      )}
    </>
  )
}
