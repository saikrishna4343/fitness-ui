import { zodResolver } from '@hookform/resolvers/zod'
import { format, parseISO } from 'date-fns'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { useCreateFoodEntry, useFoods, useUpdateFoodEntry } from '@/api/hooks'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toIsoDate } from '@/lib/format'
import { MEALS, MEAL_LABELS, type FoodEntry, type MealType } from '@/types/api'

const schema = z.object({
  name: z.string().min(1, 'Give the food a name'),
  meal: z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK']),
  /** Local wall-clock time, e.g. "08:30" — converted to an instant on submit. */
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Enter a time'),
  quantity: z.coerce.number().positive('Must be more than zero'),
  unit: z.string().min(1),
  calories: z.coerce.number().min(0, 'Calories cannot be negative'),
  proteinG: z.coerce.number().min(0),
  carbsG: z.coerce.number().min(0),
  fatG: z.coerce.number().min(0),
  notes: z.string().optional(),
  saveFood: z.boolean(),
})

type FormValues = z.input<typeof schema>

function defaults(entry?: FoodEntry): FormValues {
  if (entry) {
    return {
      name: entry.name,
      meal: entry.meal,
      time: format(parseISO(entry.eatenAt), 'HH:mm'),
      quantity: entry.quantity,
      unit: entry.unit,
      calories: entry.calories,
      proteinG: entry.proteinG,
      carbsG: entry.carbsG,
      fatG: entry.fatG,
      notes: entry.notes ?? '',
      saveFood: false,
    }
  }
  return {
    name: '',
    meal: mealForNow(),
    time: format(new Date(), 'HH:mm'),
    quantity: 1,
    unit: 'serving',
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    notes: '',
    saveFood: false,
  }
}

/** A sensible default so most entries need no meal change. */
function mealForNow(): MealType {
  const hour = new Date().getHours()
  if (hour < 11) return 'BREAKFAST'
  if (hour < 15) return 'LUNCH'
  if (hour < 21) return 'DINNER'
  return 'SNACK'
}

export function FoodEntryDialog({
  open,
  onOpenChange,
  date,
  entry,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  date: Date
  entry?: FoodEntry
}) {
  const isoDate = toIsoDate(date)
  const create = useCreateFoodEntry(isoDate)
  const update = useUpdateFoodEntry(isoDate)
  const [search, setSearch] = useState('')
  const { data: savedFoods = [] } = useFoods('')

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults(entry),
  })

  // Reopening the dialog for a different entry must not keep the previous values.
  useEffect(() => {
    if (open) {
      form.reset(defaults(entry))
      setSearch('')
    }
  }, [open, entry, form])

  const suggestions = search.trim()
    ? savedFoods
        .filter((food) => food.name.toLowerCase().includes(search.trim().toLowerCase()))
        .slice(0, 6)
    : []

  const onSubmit = form.handleSubmit((raw) => {
    const values = schema.parse(raw)
    const [hours, minutes] = values.time.split(':').map(Number)
    const eatenAt = new Date(date)
    eatenAt.setHours(hours, minutes, 0, 0)

    const body = {
      entryDate: isoDate,
      eatenAt: eatenAt.toISOString(),
      meal: values.meal,
      name: values.name,
      quantity: values.quantity,
      unit: values.unit,
      calories: values.calories,
      proteinG: values.proteinG,
      carbsG: values.carbsG,
      fatG: values.fatG,
      notes: values.notes || null,
      saveFood: values.saveFood,
    }

    const onSuccess = () => {
      toast.success(entry ? 'Entry updated' : `${values.name} logged`)
      onOpenChange(false)
    }
    const onError = (error: Error) => toast.error(error.message)

    if (entry) {
      update.mutate({ id: entry.id, body }, { onSuccess, onError })
    } else {
      create.mutate(body, { onSuccess, onError })
    }
  })

  const pending = create.isPending || update.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{entry ? 'Edit entry' : 'Log food'}</DialogTitle>
          <DialogDescription>
            Enter what you ate, its calories and macros, and the time you ate it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="food-name">Food</Label>
            <Input
              id="food-name"
              autoComplete="off"
              placeholder="e.g. Chicken and rice"
              {...form.register('name')}
              onChange={(event) => {
                form.setValue('name', event.target.value)
                setSearch(event.target.value)
              }}
            />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}

            {suggestions.length > 0 && (
              <ul className="rounded-md border bg-popover p-1 text-sm shadow-sm">
                {suggestions.map((food) => (
                  <li key={food.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-accent"
                      onClick={() => {
                        form.setValue('name', food.name)
                        form.setValue('unit', food.servingUnit)
                        form.setValue('quantity', food.servingSize)
                        form.setValue('calories', food.calories)
                        form.setValue('proteinG', food.proteinG)
                        form.setValue('carbsG', food.carbsG)
                        form.setValue('fatG', food.fatG)
                        setSearch('')
                      }}
                    >
                      <span>{food.name}</span>
                      <span className="text-xs text-muted-foreground">{food.calories} kcal</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="food-meal">Meal</Label>
              <Select
                value={form.watch('meal')}
                onValueChange={(value) => form.setValue('meal', value as MealType)}
              >
                <SelectTrigger id="food-meal" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEALS.map((meal) => (
                    <SelectItem key={meal} value={meal}>
                      {MEAL_LABELS[meal]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="food-time">Time eaten</Label>
              <Input id="food-time" type="time" {...form.register('time')} />
              {form.formState.errors.time && (
                <p className="text-xs text-destructive">{form.formState.errors.time.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="food-quantity">Quantity</Label>
              <Input id="food-quantity" type="number" step="0.25" {...form.register('quantity')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="food-unit">Unit</Label>
              <Input id="food-unit" placeholder="serving, g, bowl" {...form.register('unit')} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="food-calories">Calories (kcal)</Label>
            <Input id="food-calories" type="number" step="1" {...form.register('calories')} />
            {form.formState.errors.calories && (
              <p className="text-xs text-destructive">{form.formState.errors.calories.message}</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="food-protein">Protein (g)</Label>
              <Input id="food-protein" type="number" step="0.1" {...form.register('proteinG')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="food-carbs">Carbs (g)</Label>
              <Input id="food-carbs" type="number" step="0.1" {...form.register('carbsG')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="food-fat">Fat (g)</Label>
              <Input id="food-fat" type="number" step="0.1" {...form.register('fatG')} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="food-notes">Notes</Label>
            <Input id="food-notes" placeholder="Optional" {...form.register('notes')} />
          </div>

          {!entry && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="food-save"
                checked={form.watch('saveFood')}
                onCheckedChange={(checked) => form.setValue('saveFood', checked === true)}
              />
              <Label htmlFor="food-save" className="font-normal">
                Save to my foods for one-click reuse
              </Label>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : entry ? 'Save changes' : 'Log food'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
