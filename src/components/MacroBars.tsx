import { grams, percent } from '@/lib/format'
import type { DailySummary } from '@/types/api'

const MACROS = [
  { key: 'protein', label: 'Protein', bar: 'bg-chart-1' },
  { key: 'carbs', label: 'Carbs', bar: 'bg-chart-2' },
  { key: 'fat', label: 'Fat', bar: 'bg-chart-3' },
] as const

export function MacroBars({ summary }: { summary: DailySummary }) {
  const values = {
    protein: { value: summary.proteinG, goal: summary.proteinGoal },
    carbs: { value: summary.carbsG, goal: summary.carbsGoal },
    fat: { value: summary.fatG, goal: summary.fatGoal },
  }

  return (
    <div className="space-y-4">
      {MACROS.map(({ key, label, bar }) => {
        const { value, goal } = values[key]
        const pct = percent(value, goal)
        return (
          <div key={key}>
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="font-medium">{label}</span>
              <span className="tabular-nums text-muted-foreground">
                {grams(value)} / {goal} g
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${bar} transition-[width] duration-300`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
