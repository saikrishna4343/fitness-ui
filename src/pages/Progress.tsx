import { format, parseISO, subDays } from 'date-fns'
import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, XAxis, YAxis } from 'recharts'
import { useSummaryRange } from '@/api/hooks'
import { PageHeader } from '@/components/AppShell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { grams, kcal, toIsoDate } from '@/lib/format'
import type { DailySummary } from '@/types/api'

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
]

// The Progress version of the dashboard's blue ring: food eaten against the day's budget
// (goal + exercise). Over budget is red, as the ring turns red, and the legend and the
// tooltip say it in words too, so the colour is never the only signal.
const energyConfig = {
  calories: { label: 'Food eaten', color: 'var(--chart-1)' },
  budget: { label: 'Budget', color: 'var(--foreground)' },
} satisfies ChartConfig

type EnergyRow = DailySummary & { label: string; budget: number | null }

const macroConfig = {
  proteinG: { label: 'Protein', color: 'var(--chart-1)' },
  carbsG: { label: 'Carbs', color: 'var(--chart-2)' },
  fatG: { label: 'Fat', color: 'var(--chart-3)' },
} satisfies ChartConfig

export default function Progress() {
  const [days, setDays] = useState(30)
  const today = new Date()
  const from = toIsoDate(subDays(today, days - 1))
  const to = toIsoDate(today)

  const { data: summaries = [], isLoading } = useSummaryRange(from, to)

  const rows = useMemo<EnergyRow[]>(
    () =>
      summaries.map((day) => ({
        ...day,
        label: format(parseISO(day.date), 'd MMM'),
        // What the day allowed: the goal plus what exercise burned -- the blue ring's
        // denominator. Null on a day with nothing logged, so an empty day shows no
        // marker waiting for a bar that will never come.
        budget: day.entryCount > 0 ? day.calorieGoal + day.caloriesBurned : null,
      })),
    [summaries],
  )

  const stats = useMemo(() => computeStats(summaries), [summaries])

  return (
    <>
      <PageHeader
        title="Progress"
        description="How your intake and training have tracked over time."
        actions={
          <div className="flex gap-1 rounded-lg border p-1">
            {RANGES.map((range) => (
              <Button
                key={range.days}
                size="sm"
                variant={days === range.days ? 'secondary' : 'ghost'}
                onClick={() => setDays(range.days)}
              >
                {range.label}
              </Button>
            ))}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Avg. eaten / day" value={kcal(stats.avgCalories)} unit="kcal" />
        <StatTile
          label="Avg. burned / workout"
          value={kcal(stats.avgBurned)}
          unit="kcal"
        />
        <StatTile
          label="Within budget"
          value={String(stats.withinBudget)}
          unit={`of ${stats.daysLogged} logged days`}
        />
        <StatTile
          label="Burn target hit"
          value={String(stats.burnGoalHit)}
          unit={`of ${stats.targetDays} days with a target`}
        />
        <StatTile label="Workouts completed" value={String(stats.workoutsCompleted)} />
        <StatTile label="Current streak" value={String(stats.streak)} unit="days" />
      </div>

      {isLoading ? (
        <Skeleton className="h-80 w-full" />
      ) : (
        <Tabs defaultValue="chart" className="space-y-4">
          <TabsList>
            <TabsTrigger value="chart">Charts</TabsTrigger>
            <TabsTrigger value="table">Table</TabsTrigger>
          </TabsList>

          <TabsContent value="chart" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Energy balance</CardTitle>
                <CardDescription>
                  Each bar is the food you ate. The line across it is that day&apos;s budget:
                  your goal plus what you burned. Stay under the line to stay within budget.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <EnergyLegend />
                <ChartContainer config={energyConfig} className="h-72 w-full">
                  <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} strokeOpacity={0.4} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      minTickGap={24}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={48}
                      tickMargin={4}
                      tickFormatter={(value: number) => kcal(value)}
                    />
                    <ChartTooltip cursor={{ opacity: 0.12 }} content={<EnergyTooltip />} />
                    <Bar dataKey="calories" radius={[4, 4, 0, 0]} maxBarSize={28}>
                      {rows.map((row) => (
                        <Cell
                          key={row.date}
                          fill={row.caloriesRemaining < 0 ? 'var(--destructive)' : 'var(--color-calories)'}
                        />
                      ))}
                    </Bar>
                    {/* Drawn as a tick per day rather than a connected line: each day has
                        its own budget, and a line joining them would suggest a trend. */}
                    <Line
                      dataKey="budget"
                      stroke="none"
                      isAnimationActive={false}
                      dot={<BudgetTick halfWidth={days <= 7 ? 16 : days <= 30 ? 8 : 3} />}
                      activeDot={false}
                    />
                  </ComposedChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Macros per day</CardTitle>
                <CardDescription>Grams of protein, carbs and fat, stacked.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={macroConfig} className="h-72 w-full">
                  <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} strokeOpacity={0.4} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      minTickGap={24}
                    />
                    <YAxis tickLine={false} axisLine={false} width={44} tickMargin={4} />
                    <ChartTooltip content={<ChartTooltipContent />} cursor={{ opacity: 0.12 }} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="proteinG" stackId="macros" fill="var(--color-proteinG)" />
                    <Bar dataKey="carbsG" stackId="macros" fill="var(--color-carbsG)" />
                    <Bar dataKey="fatG" stackId="macros" fill="var(--color-fatG)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="table">
            <Card>
              <CardHeader>
                <CardTitle>Day by day</CardTitle>
                <CardDescription>The same numbers behind the charts.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Eaten</TableHead>
                      <TableHead className="text-right">Burned</TableHead>
                      <TableHead className="text-right">Burn target</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead className="text-right">Goal</TableHead>
                      <TableHead className="text-right">Protein</TableHead>
                      <TableHead className="text-right">Carbs</TableHead>
                      <TableHead className="text-right">Fat</TableHead>
                      <TableHead>Workout</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...rows].reverse().map((row) => (
                      <TableRow key={row.date}>
                        <TableCell className="whitespace-nowrap">{row.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{kcal(row.calories)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {kcal(row.caloriesBurned)}
                          {row.burnSource === 'ESTIMATED' && (
                            <span className="ml-1 text-xs text-muted-foreground" title="Estimated">
                              est.
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                          {row.burnGoal > 0 ? kcal(row.burnGoal) : '—'}
                          {row.burnGoal > 0 && row.caloriesBurned >= row.burnGoal && (
                            <span className="ml-1 text-foreground" title="Target hit">
                              ✓
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{kcal(row.netCalories)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {kcal(row.calorieGoal)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{grams(row.proteinG)} g</TableCell>
                        <TableCell className="text-right tabular-nums">{grams(row.carbsG)} g</TableCell>
                        <TableCell className="text-right tabular-nums">{grams(row.fatG)} g</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {row.workoutFocus
                            ? `${row.workoutFocus} · ${row.exercisesCompleted}/${row.exercisesTotal}`
                            : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </>
  )
}

function EnergyLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-[2px] bg-chart-1" aria-hidden />
        Within budget
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-[2px] bg-destructive" aria-hidden />
        Over budget
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-3.5 rounded-full bg-foreground" aria-hidden />
        Budget (goal + exercise)
      </span>
    </div>
  )
}

/** The budget marker: a short horizontal line centred on the day's bar. */
function BudgetTick({ cx, cy, halfWidth = 8 }: { cx?: number; cy?: number; halfWidth?: number }) {
  if (cx == null || cy == null || Number.isNaN(cy)) return null
  return (
    <line
      x1={cx - halfWidth}
      x2={cx + halfWidth}
      y1={cy}
      y2={cy}
      stroke="var(--foreground)"
      strokeWidth={2}
      strokeLinecap="round"
    />
  )
}

/** Hovering a day shows the same sum as the boxes under the dashboard ring. */
function EnergyTooltip({ active, payload }: { active?: boolean; payload?: { payload: EnergyRow }[] }) {
  const day = payload?.[0]?.payload
  if (!active || !day) return null
  const over = day.caloriesRemaining < 0
  return (
    <div className="grid min-w-44 gap-1 rounded-lg border bg-background px-3 py-2 text-xs shadow-xl">
      <p className="font-medium">{format(parseISO(day.date), 'EEE d MMM')}</p>
      <Row label="Goal" value={kcal(day.calorieGoal)} />
      <Row label="+ Exercise" value={kcal(day.caloriesBurned)} />
      <Row label="− Food" value={kcal(day.calories)} />
      <div className="mt-0.5 border-t pt-1">
        <Row
          label={over ? '= Over' : '= Left'}
          value={kcal(Math.abs(day.caloriesRemaining))}
          strong={over ? 'text-destructive' : 'text-foreground'}
        />
      </div>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className={strong ? `font-medium ${strong}` : 'text-muted-foreground'}>{label}</span>
      <span className={`tabular-nums ${strong ? `font-medium ${strong}` : 'text-foreground'}`}>
        {value} kcal
      </span>
    </div>
  )
}

function StatTile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
          {value}
          {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
        </p>
      </CardContent>
    </Card>
  )
}

function computeStats(summaries: DailySummary[]) {
  const logged = summaries.filter((day) => day.entryCount > 0)
  const avgCalories =
    logged.length === 0 ? 0 : logged.reduce((total, day) => total + day.calories, 0) / logged.length

  // Days that asked for any burning: every training day (the minimum), and a rest day
  // only when it was eaten over its goal.
  const targeted = summaries.filter((day) => day.burnGoal > 0)
  const burned = summaries.filter((day) => day.caloriesBurned > 0)
  const avgBurned =
    burned.length === 0 ? 0 : burned.reduce((total, day) => total + day.caloriesBurned, 0) / burned.length

  const withinBudget = logged.filter((day) => day.caloriesRemaining >= 0).length
  const burnGoalHit = targeted.filter((day) => day.caloriesBurned >= day.burnGoal).length
  const workoutsCompleted = summaries.filter((day) => day.workoutStatus === 'COMPLETED').length

  // Consecutive days ending today on which something was logged.
  let streak = 0
  for (let i = summaries.length - 1; i >= 0; i--) {
    if (summaries[i].entryCount === 0) break
    streak++
  }

  return {
    avgCalories,
    avgBurned,
    daysLogged: logged.length,
    withinBudget,
    targetDays: targeted.length,
    burnGoalHit,
    workoutsCompleted,
    streak,
  }
}
