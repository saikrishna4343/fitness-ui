import { format } from 'date-fns'
import { Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useDailySummary, useDeleteFoodEntry, useFoodEntries } from '@/api/hooks'
import { PageHeader } from '@/components/AppShell'
import { DatePicker } from '@/components/DatePicker'
import { FoodEntryDialog } from '@/components/FoodEntryDialog'
import { GoalDialog } from '@/components/GoalDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatTime, grams, kcal, toIsoDate } from '@/lib/format'
import { MEALS, MEAL_LABELS, type DailySummary, type FoodEntry } from '@/types/api'

export default function FoodLog() {
  const [date, setDate] = useState(new Date())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [goalOpen, setGoalOpen] = useState(false)
  const [editing, setEditing] = useState<FoodEntry | undefined>()

  const isoDate = toIsoDate(date)
  const { data: entries = [], isLoading } = useFoodEntries(isoDate)
  const { data: summary } = useDailySummary(isoDate)
  const remove = useDeleteFoodEntry(isoDate)

  function openNew() {
    setEditing(undefined)
    setDialogOpen(true)
  }

  function openEdit(entry: FoodEntry) {
    setEditing(entry)
    setDialogOpen(true)
  }

  return (
    <>
      <PageHeader
        title="Food log"
        description="Everything you ate, and when."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DatePicker value={date} onChange={setDate} />
            <Button onClick={openNew} className="gap-2">
              <Plus className="size-4" />
              Log food
            </Button>
          </div>
        }
      />

      {summary && (
        <Card className="mb-4">
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat
                label="Calories"
                value={`${kcal(summary.calories)} / ${kcal(summary.calorieGoal)}`}
              />
              <Stat label="Protein" value={`${grams(summary.proteinG)} g`} />
              <Stat label="Carbs" value={`${grams(summary.carbsG)} g`} />
              <Stat label="Fat" value={`${grams(summary.fatG)} g`} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">{goalProvenance(summary)}</p>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setGoalOpen(true)}>
                <Target className="size-4" />
                Edit goal
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <p className="text-sm text-muted-foreground">Nothing logged for this day.</p>
            <Button onClick={openNew}>Log food</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {MEALS.map((meal) => {
            const mealEntries = entries.filter((entry) => entry.meal === meal)
            if (mealEntries.length === 0) return null
            const mealCalories = mealEntries.reduce((total, entry) => total + entry.calories, 0)

            return (
              <Card key={meal}>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="text-base">{MEAL_LABELS[meal]}</CardTitle>
                  <Badge variant="secondary" className="tabular-nums">
                    {kcal(mealCalories)} kcal
                  </Badge>
                </CardHeader>
                <CardContent className="pt-0">
                  <ul className="divide-y">
                    {mealEntries.map((entry) => (
                      <li key={entry.id} className="flex items-center gap-3 py-3">
                        <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">
                          {formatTime(entry.eatenAt)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{entry.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {entry.quantity} {entry.unit} · P {grams(entry.proteinG)} · C{' '}
                            {grams(entry.carbsG)} · F {grams(entry.fatG)}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm tabular-nums">{kcal(entry.calories)}</span>
                        <div className="flex shrink-0">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(entry)}>
                            <Pencil className="size-4" />
                            <span className="sr-only">Edit {entry.name}</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              remove.mutate(entry.id, {
                                onSuccess: () => toast.success('Entry deleted'),
                                onError: (error) => toast.error(error.message),
                              })
                            }
                          >
                            <Trash2 className="size-4 text-destructive" />
                            <span className="sr-only">Delete {entry.name}</span>
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <FoodEntryDialog open={dialogOpen} onOpenChange={setDialogOpen} date={date} entry={editing} />
      <GoalDialog open={goalOpen} onOpenChange={setGoalOpen} date={date} />
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}

/**
 * Without this line a carried goal is indistinguishable from one set for the day, and
 * editing an older goal looks like it changed today's target out of nowhere.
 */
function goalProvenance(summary: DailySummary): string {
  if (summary.goalSource === 'EXPLICIT') return 'Goal set for this day.'
  if (summary.goalSource === 'CARRIED' && summary.goalSetOn) {
    return `Goal carried from ${format(new Date(`${summary.goalSetOn}T00:00:00`), 'd MMM')}.`
  }
  return 'Using your default goal from Settings.'
}
