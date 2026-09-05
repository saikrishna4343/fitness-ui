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

/**
 * Whole years since `birthDate`, or null when there is no date or it is not a date.
 *
 * Derived on every read rather than stored: an age written down is wrong within
 * a year, and this is the number a calorie target is built from.
 */
export function ageFrom(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null
  const born = parseISO(birthDate)
  if (Number.isNaN(born.getTime())) return null

  const today = new Date()
  let age = today.getFullYear() - born.getFullYear()
  // The birthday has not come round yet this year, so a year has not been lived.
  const monthDiff = today.getMonth() - born.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < born.getDate())) age -= 1

  return age >= 0 && age < 130 ? age : null
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
