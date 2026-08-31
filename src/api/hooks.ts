import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import type {
  AddSessionExerciseRequest,
  DailySummary,
  Food,
  FoodEntry,
  FoodEntryRequest,
  GoalSource,
  Plan,
  PlanDay,
  PlanExercise,
  PlanExerciseRequest,
  Profile,
  ResolvedGoal,
  SetGoalRequest,
  TickExerciseRequest,
  UpdateProfileRequest,
  UpdateWorkoutRequest,
  Workout,
  WorkoutExercise,
  WorkoutStatus,
} from '@/types/api'

/**
 * Every call in this file goes straight to Supabase — PostgREST for CRUD, RPC for the
 * handful of things that carried real logic. There is no application server any more.
 *
 * Two rules hold throughout:
 *
 *   1. Nothing filters by user id. Row level security does it, in the database, on
 *      every query — including the ones nobody remembered to check.
 *   2. Postgres is snake_case and the UI is camelCase. The conversion happens here and
 *      nowhere else, so `src/types/api.ts` and all eleven consuming pages are unchanged.
 */

/** Turns a PostgrestError into the one error shape the pages already handle. */
function fail(error: { message: string; code?: string }): never {
  if (error.code === 'PGRST301' || error.code === '42501') {
    throw new ApiError(403, 'You do not have access to that.')
  }
  if (error.code === 'PGRST106') {
    throw new ApiError(
      0,
      'The `fitness` schema is not exposed to the Data API. Add it under ' +
        'Integrations → Data API → Settings → Exposed schemas.',
    )
  }
  throw new ApiError(400, error.message)
}

/**
 * Unwraps a supabase-js result, or throws.
 *
 * `data` is deliberately `unknown`: without generated database types, supabase-js
 * types a select carrying column aliases as GenericStringError[], and narrowing here
 * would force an `as unknown as T` at every call site.
 */
function ok<T>(result: { data: unknown; error: { message: string; code?: string } | null }): T {
  if (result.error) fail(result.error)
  return result.data as T
}

export const queryKeys = {
  profile: ['profile'] as const,
  foods: (query: string) => ['foods', query] as const,
  entries: (date: string) => ['food-entries', date] as const,
  summary: (date: string) => ['summary', date] as const,
  range: (from: string, to: string) => ['summary-range', from, to] as const,
  plan: ['plan'] as const,
  workout: (date: string) => ['workout', date] as const,
  goals: (from: string, to: string) => ['goals', from, to] as const,
}

/** Everything derived from a day's food or workout, refetched together after any write. */
function invalidateDay(client: ReturnType<typeof useQueryClient>, date: string) {
  void client.invalidateQueries({ queryKey: queryKeys.entries(date) })
  void client.invalidateQueries({ queryKey: queryKeys.summary(date) })
  void client.invalidateQueries({ queryKey: queryKeys.workout(date) })
  void client.invalidateQueries({ queryKey: ['summary-range'] })
}

/**
 * A goal write moves the ring, the remaining count and the Progress goal line at once.
 * Goals carry forward, so a single write can change every later day — invalidate the
 * whole key, never one date.
 */
function invalidateGoals(client: ReturnType<typeof useQueryClient>) {
  void client.invalidateQueries({ queryKey: ['goals'] })
  void client.invalidateQueries({ queryKey: ['summary'] })
  void client.invalidateQueries({ queryKey: ['summary-range'] })
}

// ---------------------------------------------------------------- row shapes

type ProfileRow = {
  user_id: string
  first_name: string | null
  last_name: string | null
  sex: string | null
  height_cm: number | null
  weight_kg: number | null
  activity_level: string
  goal: string
  daily_calorie_goal: number
  protein_goal: number
  carbs_goal: number
  fat_goal: number
  timezone: string
}

type SummaryRow = {
  date: string
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  calorie_goal: number
  protein_goal: number
  carbs_goal: number
  fat_goal: number
  calories_remaining: number
  entry_count: number
  workout_focus: string | null
  workout_status: WorkoutStatus | null
  exercises_completed: number
  exercises_total: number
  goal_source: GoalSource
  goal_set_on: string | null
}

const toProfile = (r: ProfileRow): Profile => ({
  userId: r.user_id,
  firstName: r.first_name,
  lastName: r.last_name,
  sex: r.sex,
  heightCm: r.height_cm,
  weightKg: r.weight_kg,
  activityLevel: r.activity_level,
  goal: r.goal,
  dailyCalorieGoal: r.daily_calorie_goal,
  proteinGoal: r.protein_goal,
  carbsGoal: r.carbs_goal,
  fatGoal: r.fat_goal,
  timezone: r.timezone,
})

const toSummary = (r: SummaryRow): DailySummary => ({
  date: r.date,
  calories: r.calories,
  proteinG: Number(r.protein_g),
  carbsG: Number(r.carbs_g),
  fatG: Number(r.fat_g),
  calorieGoal: r.calorie_goal,
  proteinGoal: r.protein_goal,
  carbsGoal: r.carbs_goal,
  fatGoal: r.fat_goal,
  caloriesRemaining: r.calories_remaining,
  entryCount: r.entry_count,
  workoutFocus: r.workout_focus,
  workoutStatus: r.workout_status,
  exercisesCompleted: r.exercises_completed,
  exercisesTotal: r.exercises_total,
  goalSource: r.goal_source,
  goalSetOn: r.goal_set_on,
})

const toGoal = (r: SummaryRow): ResolvedGoal => ({
  date: r.date,
  dailyCalorieGoal: r.calorie_goal,
  proteinGoal: r.protein_goal,
  carbsGoal: r.carbs_goal,
  fatGoal: r.fat_goal,
  source: r.goal_source,
  setOn: r.goal_set_on,
})

/** Select aliases rename server-side, so these come back already camelCased. */
const FOOD_COLS =
  'id, name, brand, servingSize:serving_size, servingUnit:serving_unit, ' +
  'calories, proteinG:protein_g, carbsG:carbs_g, fatG:fat_g'

const ENTRY_COLS =
  'id, foodId:food_id, entryDate:entry_date, eatenAt:eaten_at, meal, name, ' +
  'quantity, unit, calories, proteinG:protein_g, carbsG:carbs_g, fatG:fat_g, notes'

const PLAN_EXERCISE_COLS =
  'id, name, targetSets:target_sets, targetReps:target_reps, ' +
  'targetWeightKg:target_weight_kg, orderIndex:order_index, notes'

const SESSION_EXERCISE_COLS =
  'id, name, targetSets:target_sets, targetReps:target_reps, ' +
  'targetWeightKg:target_weight_kg, actualWeightKg:actual_weight_kg, ' +
  'actualReps:actual_reps, completed, completedAt:completed_at, ' +
  'orderIndex:order_index, notes'

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
/** dayName is derived on read, never stored — same as the Java DtoMapper did. */
const dayName = (isoDayOfWeek: number) => DAY_NAMES[isoDayOfWeek - 1] ?? ''

// ---------------------------------------------------------------- profile

export function useProfile() {
  return useQuery({
    queryKey: queryKeys.profile,
    // Creates the row on first call, exactly as GET /api/profile used to.
    queryFn: async () => toProfile(ok(await supabase.rpc('ensure_profile'))),
  })
}

export function useUpdateProfile() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (body: UpdateProfileRequest) => {
      const patch: Record<string, unknown> = {}
      if (body.firstName !== undefined) patch.first_name = body.firstName
      if (body.lastName !== undefined) patch.last_name = body.lastName
      if (body.sex !== undefined) patch.sex = body.sex
      if (body.heightCm !== undefined) patch.height_cm = body.heightCm
      if (body.weightKg !== undefined) patch.weight_kg = body.weightKg
      if (body.activityLevel !== undefined) patch.activity_level = body.activityLevel
      if (body.goal !== undefined) patch.goal = body.goal
      if (body.dailyCalorieGoal !== undefined) patch.daily_calorie_goal = body.dailyCalorieGoal
      if (body.proteinGoal !== undefined) patch.protein_goal = body.proteinGoal
      if (body.carbsGoal !== undefined) patch.carbs_goal = body.carbsGoal
      if (body.fatGoal !== undefined) patch.fat_goal = body.fatGoal
      if (body.timezone !== undefined) patch.timezone = body.timezone

      const { data: session } = await supabase.auth.getSession()
      const rows = ok(
        await supabase
          .from('user_profile')
          .update(patch)
          .eq('user_id', session.session?.user.id ?? '')
          .select('*'),
      ) as ProfileRow[]
      return toProfile(rows[0])
    },
    onSuccess: (profile) => {
      client.setQueryData(queryKeys.profile, profile)
      void client.invalidateQueries({ queryKey: ['summary'] })
      void client.invalidateQueries({ queryKey: ['summary-range'] })
    },
  })
}

// ---------------------------------------------------------------- goals

export function useGoals(from: string, to: string) {
  return useQuery({
    queryKey: queryKeys.goals(from, to),
    queryFn: async () => {
      const rows = ok(
        await supabase.rpc('daily_summary', { p_from: from, p_to: to }),
      ) as SummaryRow[]
      return rows.map(toGoal)
    },
  })
}

export function useGoal(date: string) {
  const query = useGoals(date, date)
  return { ...query, data: query.data?.[0] }
}

export function useSetDayGoal() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ date, body }: { date: string; body: SetGoalRequest }) => {
      const { data: session } = await supabase.auth.getSession()
      ok(
        await supabase.from('daily_goal').upsert(
          {
            user_id: session.session?.user.id,
            goal_date: date,
            daily_calorie_goal: body.dailyCalorieGoal,
            protein_goal: body.proteinGoal,
            carbs_goal: body.carbsGoal,
            fat_goal: body.fatGoal,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,goal_date' },
        ),
      )
    },
    onSuccess: () => invalidateGoals(client),
  })
}

export function useSetWeekGoal() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ date, body }: { date: string; body: SetGoalRequest }) =>
      ok(
        await supabase.rpc('set_week_goal', {
          p_date: date,
          p_calories: body.dailyCalorieGoal,
          p_protein: body.proteinGoal,
          p_carbs: body.carbsGoal,
          p_fat: body.fatGoal,
        }),
      ),
    onSuccess: () => invalidateGoals(client),
  })
}

export function useClearDayGoal() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (date: string) =>
      ok(await supabase.from('daily_goal').delete().eq('goal_date', date)),
    onSuccess: () => invalidateGoals(client),
  })
}

// ---------------------------------------------------------------- foods

export function useFoods(query: string) {
  return useQuery({
    queryKey: queryKeys.foods(query),
    queryFn: async () => {
      let request = supabase.from('food').select(FOOD_COLS).order('name')
      const term = query.trim()
      if (term) request = request.or(`name.ilike.%${term}%,brand.ilike.%${term}%`)
      return ok(await request) as Food[]
    },
    staleTime: 60_000,
  })
}

export function useDeleteFood() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => ok(await supabase.from('food').delete().eq('id', id)),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['foods'] }),
  })
}

// ---------------------------------------------------------------- food entries

export function useFoodEntries(date: string) {
  return useQuery({
    queryKey: queryKeys.entries(date),
    queryFn: async () =>
      ok(
        await supabase
          .from('food_entry')
          .select(ENTRY_COLS)
          .eq('entry_date', date)
          .order('eaten_at'),
      ) as FoodEntry[],
  })
}

/** Shared by create and update. `saveFood` is request-only and never a column. */
async function entryRow(body: FoodEntryRequest) {
  const { data: session } = await supabase.auth.getSession()
  return {
    user_id: session.session?.user.id,
    food_id: body.foodId ?? null,
    entry_date: body.entryDate,
    eaten_at: body.eatenAt,
    meal: body.meal,
    name: body.name,
    quantity: body.quantity,
    unit: body.unit,
    calories: body.calories,
    protein_g: body.proteinG,
    carbs_g: body.carbsG,
    fat_g: body.fatG,
    notes: body.notes ?? null,
  }
}

export function useCreateFoodEntry(date: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (body: FoodEntryRequest) => {
      const row = await entryRow(body)
      const created = ok(
        await supabase.from('food_entry').insert(row).select(ENTRY_COLS).single(),
      ) as FoodEntry

      // saveFood was a flag on the Java request that also created a Food row.
      if (body.saveFood) {
        ok(
          await supabase.from('food').insert({
            user_id: row.user_id,
            name: body.name,
            serving_size: body.quantity,
            serving_unit: body.unit,
            calories: body.calories,
            protein_g: body.proteinG,
            carbs_g: body.carbsG,
            fat_g: body.fatG,
          }),
        )
      }
      return created
    },
    onSuccess: () => {
      invalidateDay(client, date)
      void client.invalidateQueries({ queryKey: ['foods'] })
    },
  })
}

export function useUpdateFoodEntry(date: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: FoodEntryRequest }) =>
      ok(
        await supabase
          .from('food_entry')
          .update(await entryRow(body))
          .eq('id', id)
          .select(ENTRY_COLS)
          .single(),
      ) as FoodEntry,
    onSuccess: () => invalidateDay(client, date),
  })
}

export function useDeleteFoodEntry(date: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => ok(await supabase.from('food_entry').delete().eq('id', id)),
    onSuccess: () => invalidateDay(client, date),
  })
}

// ---------------------------------------------------------------- summary

export function useDailySummary(date: string) {
  return useQuery({
    queryKey: queryKeys.summary(date),
    queryFn: async () => {
      const rows = ok(
        await supabase.rpc('daily_summary', { p_from: date, p_to: date }),
      ) as SummaryRow[]
      return toSummary(rows[0])
    },
  })
}

export function useSummaryRange(from: string, to: string) {
  return useQuery({
    queryKey: queryKeys.range(from, to),
    queryFn: async () => {
      const rows = ok(
        await supabase.rpc('daily_summary', { p_from: from, p_to: to }),
      ) as SummaryRow[]
      return rows.map(toSummary)
    },
  })
}

// ---------------------------------------------------------------- plan

type PlanDayRow = {
  id: string
  dayOfWeek: number
  focus: string
  restDay: boolean
  notes: string | null
  exercises: PlanExercise[]
}

export function usePlan() {
  return useQuery({
    queryKey: queryKeys.plan,
    queryFn: async (): Promise<Plan> => {
      // Creates the plan and all seven days on first call.
      const planId = ok(await supabase.rpc('ensure_plan')) as string

      const plan = ok(
        await supabase.from('plan').select('id, name').eq('id', planId).single(),
      ) as { id: string; name: string }

      const days = ok(
        await supabase
          .from('plan_day')
          .select(
            `id, dayOfWeek:day_of_week, focus, restDay:rest_day, notes,
             exercises:plan_exercise(${PLAN_EXERCISE_COLS})`,
          )
          .eq('plan_id', planId)
          .order('day_of_week'),
      ) as PlanDayRow[]

      return {
        id: plan.id,
        name: plan.name,
        days: days.map((d) => ({
          ...d,
          dayName: dayName(d.dayOfWeek),
          exercises: [...d.exercises].sort((a, b) => a.orderIndex - b.orderIndex),
        })) as PlanDay[],
      }
    },
  })
}

function invalidatePlan(client: ReturnType<typeof useQueryClient>) {
  void client.invalidateQueries({ queryKey: queryKeys.plan })
  // Future days are materialized from the plan, so today's card can change too.
  void client.invalidateQueries({ queryKey: ['workout'] })
}

export function useUpdatePlanDay() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({
      dayOfWeek,
      body,
    }: {
      dayOfWeek: number
      body: { focus: string; restDay: boolean; notes?: string | null }
    }) => {
      const planId = ok(await supabase.rpc('ensure_plan')) as string
      ok(
        await supabase
          .from('plan_day')
          .update({ focus: body.focus, rest_day: body.restDay, notes: body.notes ?? null })
          .eq('plan_id', planId)
          .eq('day_of_week', dayOfWeek),
      )
    },
    onSuccess: () => invalidatePlan(client),
  })
}

export function useAddPlanExercise() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ dayOfWeek, body }: { dayOfWeek: number; body: PlanExerciseRequest }) =>
      ok(
        await supabase.rpc('add_plan_exercise', {
          p_day_of_week: dayOfWeek,
          p_name: body.name,
          p_sets: body.targetSets,
          p_reps: body.targetReps,
          p_weight: body.targetWeightKg ?? null,
          p_notes: body.notes ?? null,
        }),
      ),
    onSuccess: () => invalidatePlan(client),
  })
}

export function useUpdatePlanExercise() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: PlanExerciseRequest }) =>
      ok(
        await supabase
          .from('plan_exercise')
          .update({
            name: body.name,
            target_sets: body.targetSets,
            target_reps: body.targetReps,
            target_weight_kg: body.targetWeightKg ?? null,
            notes: body.notes ?? null,
          })
          .eq('id', id),
      ),
    onSuccess: () => invalidatePlan(client),
  })
}

export function useDeletePlanExercise() {
  const client = useQueryClient()
  return useMutation({
    // RPC, not a plain delete: order_index has to be recompacted afterwards.
    mutationFn: async (id: string) => ok(await supabase.rpc('delete_plan_exercise', { p_id: id })),
    onSuccess: () => invalidatePlan(client),
  })
}

export function useReorderPlanExercises() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ dayOfWeek, exerciseIds }: { dayOfWeek: number; exerciseIds: string[] }) =>
      ok(
        await supabase.rpc('reorder_plan_exercises', {
          p_day_of_week: dayOfWeek,
          p_ids: exerciseIds,
        }),
      ),
    onSuccess: () => invalidatePlan(client),
  })
}

// ---------------------------------------------------------------- workouts

type SessionRow = {
  id: string
  sessionDate: string
  dayOfWeek: number
  focus: string
  restDay: boolean
  status: WorkoutStatus
  completedAt: string | null
  notes: string | null
  exercises: WorkoutExercise[]
}

async function fetchWorkout(date: string): Promise<Workout> {
  // The first read of a date is a write: it materialises the session from the plan.
  const sessionId = ok(await supabase.rpc('ensure_session', { p_date: date })) as string

  const row = ok(
    await supabase
      .from('workout_session')
      .select(
        `id, sessionDate:session_date, dayOfWeek:day_of_week, focus, restDay:rest_day,
         status, completedAt:completed_at, notes,
         exercises:session_exercise(${SESSION_EXERCISE_COLS})`,
      )
      .eq('id', sessionId)
      .single(),
  ) as SessionRow

  const exercises = [...row.exercises].sort((a, b) => a.orderIndex - b.orderIndex)
  return {
    ...row,
    dayName: dayName(row.dayOfWeek),
    exercises,
    completedCount: exercises.filter((x) => x.completed).length,
    totalCount: exercises.length,
  }
}

export function useWorkout(date: string) {
  return useQuery({ queryKey: queryKeys.workout(date), queryFn: () => fetchWorkout(date) })
}

export function useUpdateWorkout(date: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateWorkoutRequest }) => {
      const patch: Record<string, unknown> = {}
      if (body.restDay !== undefined) patch.rest_day = body.restDay
      if (body.focus !== undefined) patch.focus = body.focus
      if (body.notes !== undefined) patch.notes = body.notes
      ok(await supabase.from('workout_session').update(patch).eq('id', id))
      return fetchWorkout(date)
    },
    onSuccess: (workout) => {
      client.setQueryData(queryKeys.workout(date), workout)
      void client.invalidateQueries({ queryKey: queryKeys.summary(date) })
      void client.invalidateQueries({ queryKey: ['summary-range'] })
    },
  })
}

export function useAddSessionExercise(date: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: AddSessionExerciseRequest }) =>
      ok(
        await supabase.rpc('add_session_exercise', {
          p_session_id: id,
          p_name: body.name,
          p_sets: body.targetSets,
          p_reps: body.targetReps,
          p_weight: body.targetWeightKg ?? null,
          p_notes: body.notes ?? null,
        }),
      ),
    onSuccess: () => invalidateDay(client, date),
  })
}

export function useDeleteSessionExercise(date: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) =>
      ok(await supabase.rpc('delete_session_exercise', { p_id: id })),
    onSuccess: () => invalidateDay(client, date),
  })
}

/**
 * Edits the targets on ONE session's exercise. A plain update, not an RPC: nothing
 * else has to move. The plan template is untouched -- correcting today's weight is
 * not a decision about every future Monday.
 */
export function useUpdateSessionExercise(date: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: AddSessionExerciseRequest }) =>
      ok(
        await supabase
          .from('session_exercise')
          .update({
            name: body.name,
            target_sets: body.targetSets,
            target_reps: body.targetReps,
            target_weight_kg: body.targetWeightKg ?? null,
            notes: body.notes ?? null,
          })
          .eq('id', id),
      ),
    onSuccess: () => invalidateDay(client, date),
  })
}

/** Sends the ids in their new order; the server assigns order_index by position. */
export function useReorderSessionExercises(date: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ sessionId, exerciseIds }: { sessionId: string; exerciseIds: string[] }) =>
      ok(
        await supabase.rpc('reorder_session_exercises', {
          p_session_id: sessionId,
          p_ids: exerciseIds,
        }),
      ),
    onSuccess: () => invalidateDay(client, date),
  })
}

export function useReloadWorkoutFromPlan(date: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      ok(await supabase.rpc('reload_session_from_plan', { p_session_id: id }))
      return fetchWorkout(date)
    },
    onSuccess: (workout) => {
      client.setQueryData(queryKeys.workout(date), workout)
      void client.invalidateQueries({ queryKey: queryKeys.summary(date) })
      void client.invalidateQueries({ queryKey: ['summary-range'] })
    },
  })
}

/**
 * Ticking an exercise updates the cached workout immediately so the checkbox never lags,
 * then rolls back if the request fails.
 */
export function useTickExercise(date: string) {
  const client = useQueryClient()
  return useMutation({
    // RPC, not a plain update: setting completed also stamps completed_at and lifts a
    // PLANNED session to IN_PROGRESS.
    mutationFn: async ({ id, body }: { id: string; body: TickExerciseRequest }) =>
      ok(
        await supabase.rpc('tick_session_exercise', {
          p_id: id,
          p_completed: body.completed ?? null,
          p_actual_weight: body.actualWeightKg ?? null,
          p_actual_reps: body.actualReps ?? null,
          p_notes: body.notes ?? null,
        }),
      ),

    onMutate: async ({ id, body }) => {
      await client.cancelQueries({ queryKey: queryKeys.workout(date) })
      const previous = client.getQueryData<Workout>(queryKeys.workout(date))

      if (previous) {
        const exercises = previous.exercises.map((exercise) =>
          exercise.id === id ? { ...exercise, ...body } : exercise,
        )
        client.setQueryData<Workout>(queryKeys.workout(date), {
          ...previous,
          exercises,
          completedCount: exercises.filter((exercise) => exercise.completed).length,
        })
      }
      return { previous }
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) {
        client.setQueryData(queryKeys.workout(date), context.previous)
      }
    },

    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.workout(date) })
      void client.invalidateQueries({ queryKey: queryKeys.summary(date) })
      void client.invalidateQueries({ queryKey: ['summary-range'] })
    },
  })
}

export function useCompleteWorkout(date: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      ok(await supabase.rpc('complete_workout', { p_session_id: id }))
      return fetchWorkout(date)
    },
    onSuccess: (workout) => {
      client.setQueryData(queryKeys.workout(date), workout)
      void client.invalidateQueries({ queryKey: queryKeys.summary(date) })
      void client.invalidateQueries({ queryKey: ['summary-range'] })
    },
  })
}

export function useSkipWorkout(date: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      ok(await supabase.rpc('skip_workout', { p_session_id: id }))
      return fetchWorkout(date)
    },
    onSuccess: (workout) => {
      client.setQueryData(queryKeys.workout(date), workout)
      void client.invalidateQueries({ queryKey: queryKeys.summary(date) })
    },
  })
}
