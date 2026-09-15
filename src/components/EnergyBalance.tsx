import { Check } from 'lucide-react'
import { kcal } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { BurnSource, DailySummary } from '@/types/api'

/**
 * Two concentric rings for one day's energy balance.
 *
 * Outer: food eaten against the day's budget, which is the calorie goal PLUS whatever
 * exercise burned -- the same sum as `caloriesRemaining`, so the ring and the number in
 * its centre can never disagree. It fills to the budget and then turns over-budget red
 * rather than wrapping round, so being over is unmistakable.
 *
 * Inner: exercise burned against the day's burn target. Left out when the target is
 * zero (a rest day eaten within budget), because an empty ring there reads as a failure.
 */
export function EnergyRings({ summary, size = 184 }: { summary: DailySummary; size?: number }) {
  const stroke = 12
  const gap = 5
  const center = size / 2
  const outer = (size - stroke) / 2
  const inner = outer - stroke - gap

  const budget = summary.calorieGoal + summary.caloriesBurned
  const eatenRatio = budget > 0 ? summary.calories / budget : 0
  const over = eatenRatio > 1
  const burnRatio = summary.burnGoal > 0 ? summary.caloriesBurned / summary.burnGoal : 0
  const remaining = summary.caloriesRemaining
  const showBurn = summary.burnGoal > 0

  const label =
    `${kcal(summary.calories)} of ${kcal(budget)} kcal eaten, ` +
    (over ? `${kcal(-remaining)} over. ` : `${kcal(remaining)} left. `) +
    (showBurn ? `${kcal(summary.caloriesBurned)} of ${kcal(summary.burnGoal)} kcal burned.` : '')

  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={label}>
        <Arc center={center} radius={outer} stroke={stroke} ratio={1} className="stroke-muted" />
        <Arc
          center={center}
          radius={outer}
          stroke={stroke}
          ratio={eatenRatio}
          className={over ? 'stroke-destructive' : 'stroke-chart-1'}
        />
        {showBurn && (
          <>
            <Arc center={center} radius={inner} stroke={stroke} ratio={1} className="stroke-muted" />
            <Arc center={center} radius={inner} stroke={stroke} ratio={burnRatio} className="stroke-chart-4" />
          </>
        )}
      </svg>

      <div className="absolute flex flex-col items-center">
        <span
          className={cn(
            'text-3xl font-semibold tabular-nums tracking-tight',
            over && 'text-destructive',
          )}
        >
          {kcal(Math.abs(remaining))}
        </span>
        <span className="text-xs text-muted-foreground">{over ? 'kcal over' : 'kcal left'}</span>
      </div>
    </div>
  )
}

/** One ring segment, drawn from 12 o'clock when its SVG is rotated -90deg. Shared with NutrientRings. */
export function Arc({
  center,
  radius,
  stroke,
  ratio,
  className,
}: {
  center: number
  radius: number
  stroke: number
  ratio: number
  className: string
}) {
  const circumference = 2 * Math.PI * radius
  const dash = circumference * Math.min(Math.max(ratio, 0), 1)
  return (
    <circle
      cx={center}
      cy={center}
      r={radius}
      fill="none"
      strokeWidth={stroke}
      strokeLinecap={ratio >= 1 ? 'butt' : 'round'}
      // A zero-length round cap still draws a dot; draw nothing at zero instead.
      strokeDasharray={dash === 0 ? `0 ${circumference}` : `${dash} ${circumference}`}
      strokeOpacity={dash === 0 ? 0 : 1}
      className={className}
      style={{ transition: 'stroke-dasharray 400ms ease' }}
    />
  )
}

/**
 * The ring's arithmetic spelled out: goal + exercise - food = left. The budget (goal plus
 * exercise) reads first and food comes off it, the same way the blue ring fills. The swatches tie
 * each term to its ring, and the words carry it on their own, so identity is never
 * colour alone.
 */
export function EnergyEquation({ summary }: { summary: DailySummary }) {
  const over = summary.caloriesRemaining < 0
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
      <Term label="Goal" value={kcal(summary.calorieGoal)} />
      <Term
        label="Exercise"
        sign="+"
        swatch="bg-chart-4"
        value={kcal(summary.caloriesBurned)}
        note={BURN_NOTES[summary.burnSource]}
      />
      <Term label="Food" sign="−" swatch="bg-chart-1" value={kcal(summary.calories)} />
      <Term
        label={over ? 'Over' : 'Left'}
        sign="="
        value={kcal(Math.abs(summary.caloriesRemaining))}
        emphasis={over ? 'text-destructive' : 'text-foreground'}
      />
    </dl>
  )
}

const BURN_NOTES: Record<BurnSource, string | undefined> = {
  LOGGED: 'logged',
  ESTIMATED: 'estimated',
  NONE: undefined,
}

function Term({
  label,
  value,
  sign,
  swatch,
  note,
  emphasis,
}: {
  label: string
  value: string
  sign?: string
  swatch?: string
  note?: string
  emphasis?: string
}) {
  return (
    <div className="bg-card px-3 py-2.5">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {swatch && <span className={cn('size-2 shrink-0 rounded-full', swatch)} aria-hidden />}
        {label}
      </dt>
      <dd className={cn('mt-0.5 text-lg font-semibold tabular-nums', emphasis)}>
        {sign && <span className="mr-1 font-normal text-muted-foreground">{sign}</span>}
        {value}
      </dd>
      {note && <dd className="text-[11px] leading-none text-muted-foreground">{note}</dd>}
    </div>
  )
}

/**
 * Why today's burn target is what it is. The target is the larger of two numbers, and
 * which one won is the useful part: "you ate 400 over" asks for a different response
 * than "training-day minimum".
 */
function burnTargetReason(summary: DailySummary): string {
  const excess = summary.calories - summary.calorieGoal
  if (summary.burnGoal <= 0) return 'within your calorie goal'
  return excess >= summary.burnGoal
    ? `you ate ${kcal(excess)} over your goal`
    : 'training-day minimum'
}

/** One line on how today's exercise stands against the burn target, and why it is set there. */
export function BurnGoalLine({ summary }: { summary: DailySummary }) {
  const { caloriesBurned: burned, burnGoal: goal } = summary

  if (goal <= 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nothing to burn today — you are within your calorie goal.
      </p>
    )
  }
  if (burned >= goal) {
    return (
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <Check className="size-3.5 shrink-0 text-chart-4" />
        Burn target hit: {kcal(burned)} of {kcal(goal)} kcal
      </p>
    )
  }
  return (
    <p className="text-xs text-muted-foreground">
      <span className="mr-1.5 inline-block size-2 rounded-full bg-chart-4 align-middle" aria-hidden />
      {kcal(burned)} of {kcal(goal)} kcal burn target · {kcal(goal - burned)} to go
      <span className="block pl-3.5 sm:inline sm:pl-0"> ({burnTargetReason(summary)})</span>
    </p>
  )
}
