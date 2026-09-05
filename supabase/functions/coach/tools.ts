/**
 * The coach's tools: the definitions the model sees, and the code that runs them.
 *
 * Every executor takes the request-scoped Supabase client, which carries the
 * caller's JWT. That is the whole security model — row level security scopes each
 * query to the person asking, so a tool call cannot reach another account's rows
 * even when the model asks it to. There is no service-role key in this function.
 *
 * The results go to the model as raw snake_case JSON. The camelCase conversion in
 * src/api/hooks.ts exists for the UI's benefit; a language model does not care,
 * and a second mapping layer here would be one more place for the two to drift.
 *
 * TOOLS is a plain array in a fixed order, and must stay that way: tools are
 * rendered before the system prompt in the cached prefix, so a set that reorders
 * between requests silently costs a full cache miss every time.
 */

// deno-lint-ignore-file no-explicit-any
type Db = any

/** The caller, resolved once per request. */
export interface CoachContext {
  userId: string
}

export interface CoachTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
  /** True for the two that change data. Used for logging and the undo payload. */
  writes?: boolean
  run: (db: Db, input: any, ctx: CoachContext) => Promise<unknown>
}

/** Unwraps a supabase-js result the same way src/api/hooks.ts does. */
function ok<T>(result: { data: unknown; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  return result.data as T
}

const today = () => new Date().toISOString().slice(0, 10)

export const TOOLS: CoachTool[] = [
  {
    name: 'get_targets',
    description:
      'The calorie and macro targets implied by the profile: age, BMR, maintenance calories, ' +
      'and the suggested intake after the goal adjustment. All computed in the database. ' +
      'Returns a `missing` array naming profile fields that are not filled in — when it is ' +
      'non-empty the numbers are null and you must ask for the missing field rather than guess.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (db) => ok(await db.rpc('coach_targets')),
  },

  {
    name: 'get_day',
    description:
      "One day's totals: calories and macros eaten, the goal for that day and where the goal " +
      'came from, calories remaining, and the workout status. Defaults to today.',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'yyyy-MM-dd. Defaults to today.' } },
      additionalProperties: false,
    },
    run: async (db, { date }) => {
      const day = date ?? today()
      const rows = ok<unknown[]>(await db.rpc('daily_summary', { p_from: day, p_to: day }))
      return rows[0] ?? { date: day, empty: true }
    },
  },

  {
    name: 'get_range',
    description:
      'Per-day totals across a date range, for averages and trends. Use this rather than ' +
      'calling get_day repeatedly. Keep ranges to 90 days or fewer.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'yyyy-MM-dd' },
        to: { type: 'string', description: 'yyyy-MM-dd' },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    run: async (db, { from, to }) => ok(await db.rpc('daily_summary', { p_from: from, p_to: to })),
  },

  {
    name: 'get_food_entries',
    description:
      "Everything logged on one day, by meal, with the time it was eaten. Use when the " +
      'question is about what they ate rather than how much.',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'yyyy-MM-dd. Defaults to today.' } },
      additionalProperties: false,
    },
    run: async (db, { date }) =>
      ok(
        await db
          .from('food_entry')
          .select('id, meal, name, quantity, unit, calories, protein_g, carbs_g, fat_g, eaten_at')
          .eq('entry_date', date ?? today())
          .order('eaten_at'),
      ),
  },

  {
    name: 'get_last_training_day',
    description:
      'The most recent day they actually trained, with the exercises they completed and how ' +
      'many days ago it was. Already walks back past rest days and skipped days, and only ' +
      'counts days where exercises were ticked — call this once rather than checking ' +
      'yesterday and working backwards. Returns an empty array if they have never trained.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (db) => ok(await db.rpc('last_training_day')),
  },

  {
    name: 'get_training_history',
    description:
      'The last N days of sessions with their exercises, loads and whether each was completed. ' +
      'Use for progression and for spotting which muscle groups are behind.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'integer', description: 'Default 21, maximum 90.' } },
      additionalProperties: false,
    },
    run: async (db, { days }) =>
      ok(await db.rpc('training_history', { p_days: Math.min(Math.max(days ?? 21, 1), 90) })),
  },

  {
    name: 'get_weekly_plan',
    description:
      'Their weekly split: the focus for each day, which days are rest days, and the planned ' +
      'exercises. This is the template, not what they did — use get_training_history for that.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (db) => {
      const planId = ok<string>(await db.rpc('ensure_plan'))
      return ok(
        await db
          .from('plan_day')
          .select(
            'day_of_week, focus, rest_day, notes, ' +
              'plan_exercise(name, target_sets, target_reps, target_weight_kg, order_index)',
          )
          .eq('plan_id', planId)
          .order('day_of_week'),
      )
    },
  },

  {
    name: 'search_saved_foods',
    description:
      'Their saved food library. ALWAYS call this before estimating the macros of a food: if ' +
      'they have logged it before, the real numbers are already here and are better than any ' +
      'estimate you can make.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Part of a food name.' } },
      required: ['query'],
      additionalProperties: false,
    },
    run: async (db, { query }) =>
      ok(
        await db
          .from('food')
          .select('id, name, brand, serving_size, serving_unit, calories, protein_g, carbs_g, fat_g')
          .ilike('name', `%${query}%`)
          .limit(10),
      ),
  },

  {
    name: 'log_food_entry',
    description:
      'Adds one food entry to a day. Only call this when asked to log something. If the macros ' +
      'are your estimate rather than a saved food, set estimated to true so the app can label it.',
    writes: true,
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'yyyy-MM-dd. Defaults to today.' },
        meal: { type: 'string', enum: ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'] },
        name: { type: 'string' },
        quantity: { type: 'number' },
        unit: { type: 'string', description: 'g, ml, serving, piece...' },
        calories: { type: 'number' },
        protein_g: { type: 'number' },
        carbs_g: { type: 'number' },
        fat_g: { type: 'number' },
        estimated: { type: 'boolean' },
      },
      required: ['meal', 'name', 'quantity', 'unit', 'calories', 'protein_g', 'carbs_g', 'fat_g'],
      additionalProperties: false,
    },
    run: async (db, input, ctx) => {
      const date = input.date ?? today()
      const row = ok<{ id: string }[]>(
        await db
          .from('food_entry')
          .insert({
            // food_entry.user_id is NOT NULL with no default -- unlike the coach's
            // own tables, which default it to auth.uid(). RLS would reject a wrong
            // one, but it still has to be supplied.
            user_id: ctx.userId,
            entry_date: date,
            eaten_at: new Date().toISOString(),
            meal: input.meal,
            name: input.name,
            quantity: input.quantity,
            unit: input.unit,
            calories: input.calories,
            protein_g: input.protein_g,
            carbs_g: input.carbs_g,
            fat_g: input.fat_g,
            notes: input.estimated ? 'Macros estimated by the coach' : null,
          })
          .select('id'),
      )
      return { added: input.name, date, entry_ids: row.map((r) => r.id) }
    },
  },

  {
    name: 'add_todays_exercises',
    description:
      "Adds exercises to today's workout. Call this when asked to — \"add them to today\", " +
      '"put that in my workout". Pass every exercise explicitly; never refer back to a list in ' +
      'the conversation. Appends by default. mode "replace" clears the day first and REFUSES ' +
      'if anything has already been ticked, because that day holds work they actually did.',
    writes: true,
    input_schema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['append', 'replace'], description: 'Default append.' },
        exercises: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              sets: { type: 'integer' },
              reps: { type: 'string', description: 'e.g. "8-10", "12", "45s"' },
              weight_kg: { type: ['number', 'null'] },
              notes: { type: ['string', 'null'] },
            },
            required: ['name', 'sets', 'reps'],
            additionalProperties: false,
          },
        },
      },
      required: ['exercises'],
      additionalProperties: false,
    },
    run: async (db, input) => {
      const date = today()
      // The first read of a date materialises the session from the plan, exactly as
      // opening the Workout screen does.
      const sessionId = ok<string>(await db.rpc('ensure_session', { p_date: date }))

      const session = ok<{ rest_day: boolean; status: string }>(
        await db.from('workout_session').select('rest_day, status').eq('id', sessionId).single(),
      )
      const existing = ok<{ id: string; name: string; completed: boolean }[]>(
        await db.from('session_exercise').select('id, name, completed').eq('session_id', sessionId),
      )

      if (input.mode === 'replace') {
        // The same refusal "Load from plan" gives on the Workout screen. One rule
        // about when a logged session may be overwritten, not two.
        if (existing.some((e) => e.completed)) {
          return {
            replaced: false,
            reason:
              'Some exercises are already ticked, so replacing would discard work that was done. ' +
              'Append instead, or clear the day on the Workout screen first.',
          }
        }
        for (const exercise of existing) {
          ok(await db.rpc('delete_session_exercise', { p_id: exercise.id }))
        }
      }

      if (session.rest_day) {
        // A rest day holding exercises reads as a bug, so the flag moves with them —
        // the same thing the interval timer does when it adopts an empty day.
        ok(
          await db
            .from('workout_session')
            .update({ rest_day: false, focus: 'Training' })
            .eq('id', sessionId),
        )
      }

      const kept = input.mode === 'replace' ? [] : existing.map((e) => e.name.toLowerCase())
      const added: { id: string; name: string }[] = []
      const skipped: string[] = []

      // Sequential, not parallel: add_session_exercise assigns order_index from what
      // is already there, so racing these would shuffle the order they were given in.
      for (const exercise of input.exercises) {
        if (kept.includes(exercise.name.trim().toLowerCase())) {
          skipped.push(exercise.name)
          continue
        }
        const row = ok<{ id: string; name: string }>(
          await db.rpc('add_session_exercise', {
            p_session_id: sessionId,
            p_name: exercise.name.trim(),
            p_sets: exercise.sets,
            p_reps: exercise.reps,
            p_weight: exercise.weight_kg ?? null,
            p_notes: exercise.notes ?? null,
          }),
        )
        added.push({ id: row.id, name: row.name })
        kept.push(exercise.name.trim().toLowerCase())
      }

      return {
        date,
        mode: input.mode ?? 'append',
        added: added.map((a) => a.name),
        // The ids make the app's undo a real delete rather than a second guess at
        // which rows to remove.
        added_ids: added.map((a) => a.id),
        skipped_as_duplicates: skipped,
      }
    },
  },
]

export const TOOL_DEFINITIONS = TOOLS.map(({ name, description, input_schema }) => ({
  name,
  description,
  input_schema,
}))

export const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]))
