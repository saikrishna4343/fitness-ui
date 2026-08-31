import { format, parseISO, subDays } from 'date-fns'
import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts'
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

const calorieConfig = {
  calories: { label: 'Calories eaten', color: 'var(--chart-1)' },
} satisfies ChartConfig

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

  const rows = useMemo(
    () => summaries.map((day) => ({ ...day, label: format(parseISO(day.date), 'd MMM') })),
    [summaries],
  )

  const stats = useMemo(() => computeStats(summaries), [summaries])
  const calorieGoal = summaries.at(0)?.calorieGoal ?? 0

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

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Avg. calories / day" value={kcal(stats.avgCalories)} unit="kcal" />
        <StatTile label="Days logged" value={String(stats.daysLogged)} unit={`of ${days}`} />
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
                <CardTitle>Calories per day</CardTitle>
                <CardDescription>
                  Bars are what you ate. The dashed line is your {kcal(calorieGoal)} kcal goal.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={calorieConfig} className="h-72 w-full">
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
                    <ReferenceLine
                      y={calorieGoal}
                      stroke="var(--muted-foreground)"
                      strokeDasharray="4 4"
                      label={{ value: 'Goal', position: 'insideTopRight', fontSize: 11 }}
                    />
                    <Bar dataKey="calories" fill="var(--color-calories)" radius={[4, 4, 0, 0]} />
                  </BarChart>
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
                      <TableHead className="text-right">Calories</TableHead>
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
  const workoutsCompleted = summaries.filter((day) => day.workoutStatus === 'COMPLETED').length

  // Consecutive days ending today on which something was logged.
  let streak = 0
  for (let i = summaries.length - 1; i >= 0; i--) {
    if (summaries[i].entryCount === 0) break
    streak++
  }

  return { avgCalories, daysLogged: logged.length, workoutsCompleted, streak }
}
