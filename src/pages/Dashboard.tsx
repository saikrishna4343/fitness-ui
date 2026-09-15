import { UtensilsCrossed } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useDailySummary, useFoodEntries, useProfile, useWorkout } from '@/api/hooks'
import { PageHeader } from '@/components/AppShell'
import { BurnGoalLine, EnergyEquation, EnergyRings } from '@/components/EnergyBalance'
import { ExerciseChecklist } from '@/components/ExerciseChecklist'
import { MacroBars } from '@/components/MacroBars'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { formatTime, kcal, toIsoDate } from '@/lib/format'
import { MEAL_LABELS } from '@/types/api'

/** Enough to see the shape of the day without turning the card into the food log. */
const SHOWN = 5

export default function Dashboard() {
  const today = new Date()
  const isoDate = toIsoDate(today)

  const { data: profile } = useProfile()
  const { data: summary, isLoading: summaryLoading } = useDailySummary(isoDate)
  const { data: workout, isLoading: workoutLoading } = useWorkout(isoDate)
  const { data: entries = [] } = useFoodEntries(isoDate)

  // Most recent first: the meal you just logged is the one you are looking for.
  const recent = [...entries].reverse()
  const shown = recent.slice(0, SHOWN)
  const hidden = recent.length - shown.length

  // First name only -- the sidebar carries the full name. Falls back to 'Today'
  // until the profile loads, so the header never flashes a bare "Hi,".
  const greeting = profile?.firstName?.trim()

  return (
    <>
      <PageHeader
        title={greeting ? `Hi, ${greeting}` : 'Today'}
        description={new Date().toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
      />

      {/*
        Two cards, each the same shape: what the day looks like, what is in it, and the
        one button you press next. `items-start` is deliberately absent -- the cards
        stretch to match, and `mt-auto` on each footer keeps the two buttons on one line
        however unevenly the day is filled. Logging lives on the pages themselves now,
        so neither card carries a second, competing action.
      */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Calories</CardTitle>
            {summary && (
              <Badge variant={summary.caloriesRemaining < 0 ? 'destructive' : 'secondary'}>
                {summary.caloriesRemaining < 0
                  ? `${kcal(-summary.caloriesRemaining)} over`
                  : `${kcal(summary.caloriesRemaining)} left`}
              </Badge>
            )}
          </CardHeader>

          <CardContent className="flex flex-1 flex-col gap-4">
            <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
              {summaryLoading || !summary ? (
                <Skeleton className="size-46 rounded-full" />
              ) : (
                <EnergyRings summary={summary} />
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
            </div>

            {summary ? (
              <div className="space-y-2">
                <EnergyEquation summary={summary} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <BurnGoalLine summary={summary} />
                  <Link
                    to="/workout"
                    className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  >
                    {summary.burnSource === 'LOGGED' ? 'Edit calories burned' : 'Log calories burned'}
                  </Link>
                </div>
              </div>
            ) : (
              <Skeleton className="h-16 w-full" />
            )}

            <Separator />

            {shown.length === 0 ? (
              <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <UtensilsCrossed className="size-4" />
                Nothing logged yet today.
              </p>
            ) : (
              <ul className="divide-y">
                {shown.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 py-2.5">
                    <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">
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

            {hidden > 0 && (
              <Link
                to="/food"
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                {hidden} more {hidden === 1 ? 'entry' : 'entries'} today
              </Link>
            )}

            <div className="mt-auto pt-1">
              <Button asChild variant="outline" className="w-full">
                <Link to="/food">Food log</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
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

          <CardContent className="flex flex-1 flex-col gap-3">
            {workoutLoading || !workout ? (
              <>
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </>
            ) : (
              <>
                <ExerciseChecklist workout={workout} date={isoDate} />
                <div className="mt-auto pt-1">
                  <Button asChild variant="outline" className="w-full">
                    <Link to="/workout">Open full workout</Link>
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
