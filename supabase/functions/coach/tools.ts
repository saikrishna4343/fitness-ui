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
  /**
   * The caller's local calendar date, yyyy-MM-dd, sent by the browser.
   *
   * Not the server's: this function runs in UTC, and after 7pm in Chicago UTC has
   * already rolled over. Logging dinner to tomorrow because of where the server sleeps
   * is the kind of bug that quietly ruins a week of data. The app has the same rule --
   * see `toIsoDate` in src/lib/format.ts.
   */
  today: string
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
    run: async (db, { date }, ctx) => {
      const day = date ?? ctx.today
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
    run: async (db, { date }, ctx) =>
      ok(
        await db
          .from('food_entry')
          .select('id, meal, name, quantity, unit, calories, protein_g, carbs_g, fat_g, eaten_at')
          .eq('entry_date', date ?? ctx.today)
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
    name: 'log_food',
    description:
      'Logs one or more foods to a day. Call this when asked to log, add or record ' +
      'something eaten — "log that", "add it to my food log". A meal is usually several ' +
      'items: pass them all in one call rather than calling this repeatedly. Set ' +
      'estimated to true on any item whose macros you worked out yourself rather than ' +
      'read from search_saved_foods.',
    writes: true,
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'yyyy-MM-dd. Defaults to today.' },
        meal: {
          type: 'string',
          enum: ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'],
          description: 'The meal these items belong to, unless an item overrides it.',
        },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              quantity: { type: 'number' },
              unit: { type: 'string', description: 'g, ml, serving, piece...' },
              calories: { type: 'number' },
              protein_g: { type: 'number' },
              carbs_g: { type: 'number' },
              fat_g: { type: 'number' },
              meal: { type: 'string', enum: ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'] },
              estimated: { type: 'boolean' },
            },
            required: ['name', 'quantity', 'unit', 'calories', 'protein_g', 'carbs_g', 'fat_g'],
            additionalProperties: false,
          },
        },
      },
      required: ['meal', 'items'],
      additionalProperties: false,
    },
    run: async (db, input, ctx) => {
      const date = input.date ?? ctx.today
      const eatenAt = new Date().toISOString()

      const rows = ok<{ id: string; name: string }[]>(
        await db
          .from('food_entry')
          .insert(
            input.items.map((item: any) => ({
              // food_entry.user_id is NOT NULL with no default -- unlike the coach's own
              // tables, which default it to auth.uid(). RLS would reject a wrong one, but
              // it still has to be supplied.
              user_id: ctx.userId,
              entry_date: date,
              eaten_at: eatenAt,
              meal: item.meal ?? input.meal,
              name: item.name,
              quantity: item.quantity,
              unit: item.unit,
              calories: item.calories,
              protein_g: item.protein_g,
              carbs_g: item.carbs_g,
              fat_g: item.fat_g,
              notes: item.estimated ? 'Macros estimated by the coach' : null,
            })),
          )
          .select('id, name'),
      )

      return {
        date,
        logged: rows.map((row) => row.name),
        // The ids make the app's undo a real delete rather than a guess at which rows.
        entry_ids: rows.map((row) => row.id),
        calories: input.items.reduce((total: number, item: any) => total + item.calories, 0),
      }
    },
  },

  {
    name: 'add_workout_exercises',
    description:
      'Adds exercises to the workout on ONE date — today unless a date is given. Use for ' +
      '"add them to today", "put that in Friday\'s workout", "give me this tomorrow". This ' +
      'changes that one day only; use add_plan_exercises for something that should repeat ' +
      'every week. Pass every exercise explicitly; never refer back to a list in the ' +
      'conversation. Appends by default. mode "replace" clears the day first and REFUSES if ' +
      'anything has already been ticked, because that day holds work they actually did.',
    writes: true,
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'yyyy-MM-dd. Defaults to today.' },
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
    run: async (db, input, ctx) => {
      const date = input.date ?? ctx.today
      // The first read of a date materialises the session from the plan, exactly as
      // opening the Workout screen does -- which is what makes a future date work at
      // all: the day does not exist until something asks for it.
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
  {
    name: 'add_plan_exercises',
    description:
      'Adds exercises to a day of the WEEKLY PLAN — the template every week is built ' +
      'from, not one date. Use when they say "every Monday", "add this to my plan", "make ' +
      'Wednesday a leg day". A plan change shows up on that weekday from now on, and does ' +
      'NOT alter a workout already materialised for a date, including today. If it is ' +
      'unclear whether they mean one day or every week, ask before writing.',
    writes: true,
    input_schema: {
      type: 'object',
      properties: {
        day_of_week: {
          type: 'integer',
          minimum: 1,
          maximum: 7,
          description: 'ISO: 1 Monday ... 7 Sunday.',
        },
        focus: { type: 'string', description: 'Optional. Renames the day, e.g. "Push".' },
        rest_day: { type: 'boolean', description: 'Optional. Set false when adding work.' },
        exercises: {
          type: 'array',
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
      required: ['day_of_week'],
      additionalProperties: false,
    },
    run: async (db, input) => {
      // Creates the plan and all seven days on first call, exactly as the Plan screen does.
      const planId = ok<string>(await db.rpc('ensure_plan'))

      const exercises = input.exercises ?? []
      if (input.focus !== undefined || input.rest_day !== undefined || exercises.length > 0) {
        const patch: Record<string, unknown> = {}
        if (input.focus !== undefined) patch.focus = input.focus
        // A rest day holding exercises reads as a bug on the Plan screen, so adding work
        // to one clears the flag unless they explicitly asked for a rest day.
        if (input.rest_day !== undefined) patch.rest_day = input.rest_day
        else if (exercises.length > 0) patch.rest_day = false

        if (Object.keys(patch).length > 0) {
          ok(
            await db
              .from('plan_day')
              .update(patch)
              .eq('plan_id', planId)
              .eq('day_of_week', input.day_of_week),
          )
        }
      }

      const existing = ok<{ name: string }[]>(
        await db
          .from('plan_day')
          .select('plan_exercise(name)')
          .eq('plan_id', planId)
          .eq('day_of_week', input.day_of_week)
          .single(),
      ) as unknown as { plan_exercise: { name: string }[] }

      const already = new Set(
        (existing.plan_exercise ?? []).map((e) => e.name.trim().toLowerCase()),
      )
      const added: string[] = []
      const skipped: string[] = []

      // Sequential: add_plan_exercise assigns order_index from what is already there.
      for (const exercise of exercises) {
        if (already.has(exercise.name.trim().toLowerCase())) {
          skipped.push(exercise.name)
          continue
        }
        ok(
          await db.rpc('add_plan_exercise', {
            p_day_of_week: input.day_of_week,
            p_name: exercise.name.trim(),
            p_sets: exercise.sets,
            p_reps: exercise.reps,
            p_weight: exercise.weight_kg ?? null,
            p_notes: exercise.notes ?? null,
          }),
        )
        already.add(exercise.name.trim().toLowerCase())
        added.push(exercise.name)
      }

      return {
        day_of_week: input.day_of_week,
        focus: input.focus,
        added,
        skipped_as_duplicates: skipped,
        note:
          'The weekly plan changed. A workout already created for a date is a snapshot ' +
          'and is unaffected.',
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
