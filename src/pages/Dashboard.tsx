import { Plus, UtensilsCrossed } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDailySummary, useFoodEntries, useProfile, useWorkout } from '@/api/hooks'
import { PageHeader } from '@/components/AppShell'
import { CalorieRing } from '@/components/CalorieRing'
import { ExerciseChecklist } from '@/components/ExerciseChecklist'
import { FoodEntryDialog } from '@/components/FoodEntryDialog'
import { MacroBars } from '@/components/MacroBars'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatTime, kcal, toIsoDate } from '@/lib/format'
import { MEAL_LABELS } from '@/types/api'

export default function Dashboard() {
  const today = new Date()
  const isoDate = toIsoDate(today)
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data: profile } = useProfile()
  const { data: summary, isLoading: summaryLoading } = useDailySummary(isoDate)
  const { data: workout, isLoading: workoutLoading } = useWorkout(isoDate)
  const { data: entries = [] } = useFoodEntries(isoDate)

  const recent = [...entries].reverse().slice(0, 5)

  return (
    <>
      <PageHeader
        title={profile?.firstName ? `Hi, ${profile.firstName}` : 'Today'}
        description={new Date().toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
        actions={
          <Button onClick={() => setDialogOpen(true)} className="gap-2">
            <Plus className="size-4" />
            Log food
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Calories</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
            {summaryLoading || !summary ? (
              <Skeleton className="size-44 rounded-full" />
            ) : (
              <CalorieRing consumed={summary.calories} goal={summary.calorieGoal} />
            )}
            <div className="w-full flex-1">
              {summary ? (
                <MacroBars summary={summary} />
              ) : (
                <div className="space-y-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>
              Today&apos;s workout
              {workout && <span className="ml-2 text-muted-foreground">· {workout.focus}</span>}
            </CardTitle>
            {workout && !workout.restDay && (
              <Badge variant={workout.status === 'COMPLETED' ? 'default' : 'secondary'}>
                {workout.completedCount}/{workout.totalCount} done
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {workoutLoading || !workout ? (
              <>
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </>
            ) : (
              <>
                <ExerciseChecklist workout={workout} date={isoDate} />
                <Button asChild variant="outline" className="w-full">
                  <Link to="/workout">Open full workout</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Latest entries</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/food">View food log</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center">
                <UtensilsCrossed className="size-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Nothing logged yet today.</p>
                <Button size="sm" onClick={() => setDialogOpen(true)}>
                  Log your first meal
                </Button>
              </div>
            ) : (
              <ul className="divide-y">
                {recent.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 py-2.5">
                    <span className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatTime(entry.eatenAt)}
                    </span>
                    <span className="flex-1 truncate text-sm font-medium">{entry.name}</span>
                    <Badge variant="outline" className="hidden sm:inline-flex">
                      {MEAL_LABELS[entry.meal]}
                    </Badge>
                    <span className="w-20 shrink-0 text-right text-sm tabular-nums">
                      {kcal(entry.calories)} kcal
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <FoodEntryDialog open={dialogOpen} onOpenChange={setDialogOpen} date={today} />
    </>
  )
}
