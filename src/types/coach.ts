export type CoachRole = 'user' | 'assistant'

/** One turn as the UI shows it: the text, with the tool traffic stripped out. */
export interface CoachMessage {
  id: string
  role: CoachRole
  text: string
  createdAt: string
}

/**
 * What the edge function streams back, one JSON object per SSE frame.
 *
 * `wrote` is the interesting one: it fires the moment a tool changed something,
 * carrying the ids it created, so the screen can refresh and offer an undo before
 * the model has finished explaining what it did.
 */
export type CoachEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; writes: boolean }
  | { type: 'wrote'; name: string; result: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string }

/** Said while a tool runs, so a five-second pause looks like work rather than a hang. */
export const TOOL_ACTIVITY: Record<string, string> = {
  get_targets: 'Working out your targets',
  get_day: 'Checking today',
  get_range: 'Reading the last few weeks',
  get_food_entries: 'Looking at your food log',
  get_last_training_day: 'Finding your last training day',
  get_training_history: 'Reading your training history',
  get_weekly_plan: 'Checking your weekly plan',
  search_saved_foods: 'Searching your saved foods',
  log_food_entry: 'Logging that',
  add_todays_exercises: "Adding to today's workout",
}
