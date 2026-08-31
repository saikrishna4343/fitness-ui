import { format, parseISO } from 'date-fns'

/** The local calendar day as `yyyy-MM-dd`, which is what the API expects. */
export function toIsoDate(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function fromIsoDate(value: string): Date {
  return parseISO(value)
}

export function formatTime(isoInstant: string): string {
  return format(parseISO(isoInstant), 'h:mm a')
}

export function formatDayLabel(date: Date): string {
  return format(date, 'EEEE, d MMMM')
}

/**
 * The name to greet someone by. Both halves are optional -- a profile row exists
 * before the name does -- so this returns null rather than a stray space.
 */
export function fullName(
  first: string | null | undefined,
  last: string | null | undefined,
): string | null {
  return [first, last].map((part) => part?.trim()).filter(Boolean).join(' ') || null
}

/** Calories are whole numbers everywhere in the UI; macros keep one decimal when they have one. */
export function kcal(value: number | null | undefined): string {
  return Math.round(value ?? 0).toLocaleString()
}

export function grams(value: number | null | undefined): string {
  const n = value ?? 0
  return Number.isInteger(n) ? `${n}` : n.toFixed(1)
}

export function percent(value: number, of: number): number {
  if (of <= 0) return 0
  return Math.min(100, Math.round((value / of) * 100))
}
