import { kcal } from '@/lib/format'

/**
 * Calories eaten against the daily goal. The ring fills to the goal and then turns
 * over-budget red rather than wrapping around, so being over is unmistakable.
 */
export function CalorieRing({
  consumed,
  goal,
  size = 176,
}: {
  consumed: number
  goal: number
  size?: number
}) {
  const stroke = 14
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const ratio = goal > 0 ? consumed / goal : 0
  const over = ratio > 1
  const dash = circumference * Math.min(ratio, 1)
  const remaining = Math.round(goal - consumed)

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label="Calories against goal">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className={over ? 'stroke-destructive' : 'stroke-primary'}
          style={{ transition: 'stroke-dasharray 400ms ease' }}
        />
      </svg>

      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-semibold tabular-nums tracking-tight">{kcal(consumed)}</span>
        <span className="text-xs text-muted-foreground">of {kcal(goal)} kcal</span>
        <span
          className={`mt-1 text-xs font-medium tabular-nums ${over ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {over ? `${kcal(Math.abs(remaining))} over` : `${kcal(remaining)} left`}
        </span>
      </div>
    </div>
  )
}
