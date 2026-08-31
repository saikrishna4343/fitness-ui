import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { useClearDayGoal, useGoal, useSetDayGoal, useSetWeekGoal } from '@/api/hooks'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toIsoDate } from '@/lib/format'

const schema = z.object({
  dailyCalorieGoal: z.coerce.number().int().positive('Must be more than zero').max(15000),
  proteinGoal: z.coerce.number().int().positive().max(2000),
  carbsGoal: z.coerce.number().int().positive().max(2000),
  fatGoal: z.coerce.number().int().positive().max(2000),
})

type FormValues = z.input<typeof schema>

/** Day writes one date; week writes all seven of that date's week, Monday first. */
type Scope = 'day' | 'week'

export function GoalDialog({
  open,
  onOpenChange,
  date,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  date: Date
}) {
  const isoDate = toIsoDate(date)
  const [scope, setScope] = useState<Scope>('day')

  const { data: goal } = useGoal(isoDate)
  const setDay = useSetDayGoal()
  const setWeek = useSetWeekGoal()
  const clear = useClearDayGoal()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { dailyCalorieGoal: 2000, proteinGoal: 150, carbsGoal: 200, fatGoal: 65 },
  })

  // Seed from whatever is in force for this day — including a carried or default value,
  // so editing starts from the number the user is actually looking at.
  useEffect(() => {
    if (open && goal) {
      form.reset({
        dailyCalorieGoal: goal.dailyCalorieGoal,
        proteinGoal: goal.proteinGoal,
        carbsGoal: goal.carbsGoal,
        fatGoal: goal.fatGoal,
      })
    }
  }, [open, goal, form])

  /** Scope resets on close, not in an effect — the close is the event that causes it. */
  function handleOpenChange(next: boolean) {
    if (!next) setScope('day')
    onOpenChange(next)
  }

  const onSubmit = form.handleSubmit((raw) => {
    const body = schema.parse(raw)
    const onSuccess = () => {
      toast.success(
        scope === 'week'
          ? `Goal set for the week of ${format(startOfIsoWeek(date), 'd MMM')}`
          : `Goal set for ${format(date, 'd MMM')}`,
      )
      handleOpenChange(false)
    }
    const onError = (error: Error) => toast.error(error.message)

    if (scope === 'week') {
      setWeek.mutate({ date: isoDate, body }, { onSuccess, onError })
    } else {
      setDay.mutate({ date: isoDate, body }, { onSuccess, onError })
    }
  })

  function onReset() {
    clear.mutate(isoDate, {
      onSuccess: () => {
        toast.success('Reset — this day now carries the previous goal')
        handleOpenChange(false)
      },
      onError: (error) => toast.error(error.message),
    })
  }

  const pending = setDay.isPending || setWeek.isPending || clear.isPending

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set your goal</DialogTitle>
          <DialogDescription>{describe(goal?.source, goal?.setOn)}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <Tabs value={scope} onValueChange={(value) => setScope(value as Scope)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="day">{format(date, 'EEE d MMM')}</TabsTrigger>
              <TabsTrigger value="week">Whole week</TabsTrigger>
            </TabsList>
          </Tabs>

          <p className="text-xs text-muted-foreground">
            {scope === 'week'
              ? `Applies to Mon ${format(startOfIsoWeek(date), 'd MMM')} through Sun ${format(
                  endOfIsoWeek(date),
                  'd MMM',
                )}.`
              : 'Later days keep inheriting this until you set another one.'}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Calories" unit="kcal" {...form.register('dailyCalorieGoal')} />
            <Field label="Protein" unit="g" {...form.register('proteinGoal')} />
            <Field label="Carbs" unit="g" {...form.register('carbsGoal')} />
            <Field label="Fat" unit="g" {...form.register('fatGoal')} />
          </div>

          {form.formState.errors.dailyCalorieGoal && (
            <p className="text-sm text-destructive">
              {form.formState.errors.dailyCalorieGoal.message}
            </p>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            {goal?.source === 'EXPLICIT' ? (
              <Button type="button" variant="ghost" onClick={onReset} disabled={pending}>
                Reset to carried
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  unit,
  ref,
  ...props
}: React.ComponentProps<'input'> & { label: string; unit: string }) {
  const id = `goal-${label.toLowerCase()}`
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label} <span className="text-muted-foreground">({unit})</span>
      </Label>
      <Input id={id} type="number" inputMode="numeric" ref={ref} {...props} />
    </div>
  )
}

function startOfIsoWeek(date: Date): Date {
  const result = new Date(date)
  // getDay() is 0 for Sunday; shift so Monday is the start, matching the server.
  const offset = (result.getDay() + 6) % 7
  result.setDate(result.getDate() - offset)
  return result
}

function endOfIsoWeek(date: Date): Date {
  const result = startOfIsoWeek(date)
  result.setDate(result.getDate() + 6)
  return result
}

/** Says where the number on screen came from, so a carried goal isn't mistaken for a set one. */
function describe(source: string | undefined, setOn: string | null | undefined): string {
  if (source === 'EXPLICIT') return 'Set for this day.'
  if (source === 'CARRIED' && setOn) {
    return `Currently carried from ${format(new Date(`${setOn}T00:00:00`), 'd MMM')}.`
  }
  return 'Currently using your default goal from Settings.'
}
