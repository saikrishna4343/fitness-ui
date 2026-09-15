import { Check } from 'lucide-react'
import { Arc } from '@/components/EnergyBalance'
import { grams, kcal } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { DailySummary } from '@/types/api'

type Nutrient = {
  label: string
  value: number
  goal: number
  unit: 'kcal' | 'g'
  ring: string
  swatch: string
  /** Going over is fine -- protein's goal is a floor, not a ceiling. */
  goalIsMinimum?: boolean
  note?: string
}

/**
 * One day's calories and macros as four rings, each filling toward its own goal.
 *
 * Macros wear the colours they have on the dashboard bars and the Progress chart
 * (protein chart-1, carbs chart-2, fat chart-3). Calories are the total rather than a
 * fourth macro, so they are drawn in foreground ink instead of borrowing a hue that
 * already means protein. Calories count against the same budget as the dashboard ring
 * -- the goal plus exercise -- so the two screens never show different numbers left.
 */
export function NutrientRings({ summary }: { summary: DailySummary }) {
  const nutrients: Nutrient[] = [
    {
      label: 'Calories',
      value: summary.calories,
      goal: summary.calorieGoal + summary.caloriesBurned,
      unit: 'kcal',
      ring: 'stroke-foreground',
      swatch: 'bg-foreground',
      note: summary.caloriesBurned > 0 ? `incl. ${kcal(summary.caloriesBurned)} exercise` : undefined,
    },
    {
      label: 'Protein',
      value: summary.proteinG,
      goal: summary.proteinGoal,
      unit: 'g',
      ring: 'stroke-chart-1',
      swatch: 'bg-chart-1',
      goalIsMinimum: true,
    },
    { label: 'Carbs', value: summary.carbsG, goal: summary.carbsGoal, unit: 'g', ring: 'stroke-chart-2', swatch: 'bg-chart-2' },
    { label: 'Fat', value: summary.fatG, goal: summary.fatGoal, unit: 'g', ring: 'stroke-chart-3', swatch: 'bg-chart-3' },
  ]

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4">
      {nutrients.map((nutrient) => (
        <NutrientRing key={nutrient.label} nutrient={nutrient} />
      ))}
    </div>
  )
}

function NutrientRing({ nutrient }: { nutrient: Nutrient }) {
  const { label, value, goal, unit, ring, swatch, goalIsMinimum, note } = nutrient
  const size = 116
  const stroke = 10
  const center = size / 2
  const radius = (size - stroke) / 2

  const ratio = goal > 0 ? value / goal : 0
  const over = value > goal && goal > 0
  // Past a ceiling is a problem; past a floor is the point.
  const bad = over && !goalIsMinimum
  const met = over && goalIsMinimum
  const format = (n: number) => (unit === 'kcal' ? kcal(n) : grams(Math.round(n * 10) / 10))
  const diff = Math.abs(goal - value)

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div className="relative grid place-items-center" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          className="-rotate-90"
          role="img"
          aria-label={`${label}: ${format(value)} of ${format(goal)} ${unit}`}
        >
          <Arc center={center} radius={radius} stroke={stroke} ratio={1} className="stroke-muted" />
          <Arc
            center={center}
            radius={radius}
            stroke={stroke}
            ratio={ratio}
            className={bad ? 'stroke-destructive' : ring}
          />
        </svg>
        <div className="absolute flex flex-col items-center leading-tight">
          <span className={cn('text-xl font-semibold tabular-nums', bad && 'text-destructive')}>
            {format(value)}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            of {format(goal)} {unit}
          </span>
        </div>
      </div>

      <div className="space-y-0.5">
        <p className="flex items-center justify-center gap-1.5 text-sm font-medium">
          <span className={cn('size-2 rounded-full', swatch)} aria-hidden />
          {label}
        </p>
        <p
          className={cn(
            'flex items-center justify-center gap-1 text-xs tabular-nums',
            bad ? 'font-medium text-destructive' : 'text-muted-foreground',
          )}
        >
          {met && <Check className="size-3.5" />}
          {met
            ? 'Goal met'
            : over
              ? `${format(diff)} ${unit} over`
              : `${format(diff)} ${unit} left`}
        </p>
        {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
      </div>
    </div>
  )
}
