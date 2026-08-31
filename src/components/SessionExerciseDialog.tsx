import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { useAddSessionExercise } from '@/api/hooks'
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

const schema = z.object({
  name: z.string().min(1, 'Give the exercise a name'),
  targetSets: z.coerce.number().int().positive('At least one set'),
  /** Free text on purpose: "8-10", "12 each side" and "30 sec" are all valid. */
  targetReps: z.string().min(1, 'Enter a rep scheme'),
  targetWeightKg: z.string().optional(),
})

type FormValues = z.input<typeof schema>

const EMPTY: FormValues = { name: '', targetSets: 3, targetReps: '10', targetWeightKg: '' }

export function SessionExerciseDialog({
  open,
  onOpenChange,
  workoutId,
  date,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workoutId: string
  date: string
}) {
  const add = useAddSessionExercise(date)

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY })

  useEffect(() => {
    if (open) form.reset(EMPTY)
  }, [open, form])

  const onSubmit = form.handleSubmit((raw) => {
    const values = schema.parse(raw)
    const weight = values.targetWeightKg?.trim()

    add.mutate(
      {
        id: workoutId,
        body: {
          name: values.name,
          targetSets: values.targetSets,
          targetReps: values.targetReps,
          targetWeightKg: weight ? Number(weight) : null,
          notes: null,
        },
      },
      {
        onSuccess: () => {
          toast.success(`${values.name} added`)
          onOpenChange(false)
        },
        onError: (error) => toast.error(error.message),
      },
    )
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add an exercise</DialogTitle>
          <DialogDescription>
            Added to this day only — your weekly plan stays as it is.
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
              disabled={add.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? 'Adding…' : 'Add exercise'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
