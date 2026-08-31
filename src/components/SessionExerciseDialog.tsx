import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { useAddSessionExercise, useUpdateSessionExercise } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { WorkoutExercise } from '@/types/api'

const schema = z.object({
  name: z.string().min(1, 'Give the exercise a name'),
  targetSets: z.coerce.number().int().positive('At least one set'),
  /** Free text on purpose: "8-10", "12 each side" and "30 sec" are all valid. */
  targetReps: z.string().min(1, 'Enter a rep scheme'),
  targetWeightKg: z.string().optional(),
})

type FormValues = z.input<typeof schema>

const EMPTY: FormValues = { name: '', targetSets: 3, targetReps: '10', targetWeightKg: '' }

/** Prefills the form from an existing row. Weight is a string field so it can be empty. */
const toFormValues = (exercise: WorkoutExercise): FormValues => ({
  name: exercise.name,
  targetSets: exercise.targetSets,
  targetReps: exercise.targetReps,
  targetWeightKg: exercise.targetWeightKg?.toString() ?? '',
})

/**
 * Add an exercise to one day's workout, or edit one already there -- pass
 * `exercise` for the second. One dialog rather than two: the fields are identical,
 * and a second copy would drift from this one the first time the schema changes.
 */
export function SessionExerciseDialog({
  open,
  onOpenChange,
  workoutId,
  date,
  exercise,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workoutId: string
  date: string
  exercise?: WorkoutExercise
}) {
  const add = useAddSessionExercise(date)
  const update = useUpdateSessionExercise(date)
  const editing = exercise !== undefined
  const pending = add.isPending || update.isPending

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY })

  // Reset on open, not on mount: the dialog stays mounted between edits, so
  // without this the second exercise you open still shows the first one's values.
  useEffect(() => {
    if (open) form.reset(exercise ? toFormValues(exercise) : EMPTY)
  }, [open, exercise, form])

  const onSubmit = form.handleSubmit((raw) => {
    const values = schema.parse(raw)
    const weight = values.targetWeightKg?.trim()
    const body = {
      name: values.name,
      targetSets: values.targetSets,
      targetReps: values.targetReps,
      targetWeightKg: weight ? Number(weight) : null,
      notes: exercise?.notes ?? null,
    }

    const handlers = {
      onSuccess: () => {
        toast.success(`${values.name} ${editing ? 'updated' : 'added'}`)
        onOpenChange(false)
      },
      onError: (error: Error) => toast.error(error.message),
    }

    if (editing) {
      update.mutate({ id: exercise.id, body }, handlers)
    } else {
      add.mutate({ id: workoutId, body }, handlers)
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${exercise.name}` : 'Add an exercise'}</DialogTitle>
          <DialogDescription>
            {editing ? 'Changes apply' : 'Added'} to this day only — your weekly plan stays as it
            is.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="session-exercise-name">Exercise</Label>
            <Input
              id="session-exercise-name"
              placeholder="Bench press"
              autoFocus
              {...form.register('name')}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="session-exercise-sets">Sets</Label>
              <Input
                id="session-exercise-sets"
                type="number"
                inputMode="numeric"
                {...form.register('targetSets')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="session-exercise-reps">Reps</Label>
              <Input id="session-exercise-reps" placeholder="8-10" {...form.register('targetReps')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="session-exercise-weight">
                Weight <span className="text-muted-foreground">(kg)</span>
              </Label>
              <Input
                id="session-exercise-weight"
                type="number"
                step="0.5"
                placeholder="—"
                {...form.register('targetWeightKg')}
              />
            </div>
          </div>

          {form.formState.errors.targetReps && (
            <p className="text-sm text-destructive">{form.formState.errors.targetReps.message}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending
                ? editing
                  ? 'Saving…'
                  : 'Adding…'
                : editing
                  ? 'Save changes'
                  : 'Add exercise'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
