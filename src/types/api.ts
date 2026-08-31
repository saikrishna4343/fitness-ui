/** Mirrors the DTO records returned by fitness-api. */

export type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK'

export const MEALS: MealType[] = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK']

export const MEAL_LABELS: Record<MealType, string> = {
  BREAKFAST: 'Breakfast',
  LUNCH: 'Lunch',
  DINNER: 'Dinner',
  SNACK: 'Snacks',
}

export type WorkoutStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED'

export interface Profile {
  userId: string
  firstName: string | null
  lastName: string | null
  sex: string | null
  heightCm: number | null
  weightKg: number | null
  activityLevel: string
  goal: string
  dailyCalorieGoal: number
  proteinGoal: number
  carbsGoal: number
  fatGoal: number
  timezone: string
}

export type UpdateProfileRequest = Partial<Omit<Profile, 'userId'>>

/**
 * Where a day's calorie and macro goal came from.
 *
 * `EXPLICIT` — set for that exact date.
 * `CARRIED`  — inherited from the most recent earlier date that was set.
 * `DEFAULT`  — nothing set on or before it, so the profile values apply.
 */
export type GoalSource = 'EXPLICIT' | 'CARRIED' | 'DEFAULT'

export interface ResolvedGoal {
  date: string
  dailyCalorieGoal: number
  proteinGoal: number
  carbsGoal: number
  fatGoal: number
  source: GoalSource
  /** The date the number was written on. Null when it came from the profile. */
  setOn: string | null
}

/** Body of PUT /api/goals/{date} and /api/goals/week/{date}. A full replace. */
export interface SetGoalRequest {
  dailyCalorieGoal: number
  proteinGoal: number
  carbsGoal: number
  fatGoal: number
}

export interface Food {
  id: string
  name: string
  brand: string | null
  servingSize: number
  servingUnit: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export interface FoodEntry {
  id: string
  foodId: string | null
  entryDate: string
  /** ISO instant — the time of day the food was eaten. */
  eatenAt: string
  meal: MealType
  name: string
  quantity: number
  unit: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  notes: string | null
}

export interface FoodEntryRequest {
  foodId?: string | null
  entryDate: string
  eatenAt: string
  meal: MealType
  name: string
  quantity: number
  unit: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  notes?: string | null
  saveFood?: boolean
}

export interface PlanExercise {
  id: string
  name: string
  targetSets: number
  targetReps: string
  targetWeightKg: number | null
  orderIndex: number
  notes: string | null
}

export interface PlanDay {
  id: string
  /** ISO day of week: 1 = Monday ... 7 = Sunday. */
  dayOfWeek: number
  dayName: string
  focus: string
  restDay: boolean
  notes: string | null
  exercises: PlanExercise[]
}

export interface Plan {
  id: string
  name: string
  days: PlanDay[]
}

export interface PlanExerciseRequest {
  name: string
  targetSets: number
  targetReps: string
  targetWeightKg?: number | null
  notes?: string | null
}

export interface WorkoutExercise {
  id: string
  name: string
  targetSets: number
  targetReps: string
  targetWeightKg: number | null
  actualWeightKg: number | null
  actualReps: string | null
  completed: boolean
  completedAt: string | null
  orderIndex: number
  notes: string | null
}

export interface Workout {
  id: string
  sessionDate: string
  dayOfWeek: number
  dayName: string
  focus: string
  restDay: boolean
  status: WorkoutStatus
  completedAt: string | null
  notes: string | null
  completedCount: number
  totalCount: number
  exercises: WorkoutExercise[]
}

/** Body of PATCH /api/workouts/{id}. Partial — omitted fields are left unchanged. */
export interface UpdateWorkoutRequest {
  restDay?: boolean
  focus?: string
  notes?: string | null
}

/** Body of POST /api/workouts/{id}/exercises. Adds to this session only, not the plan. */
export interface AddSessionExerciseRequest {
  name: string
  targetSets: number
  targetReps: string
  targetWeightKg?: number | null
  notes?: string | null
}

export interface TickExerciseRequest {
  completed?: boolean
  actualWeightKg?: number | null
  actualReps?: string | null
  notes?: string | null
}

export interface DailySummary {
  date: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  calorieGoal: number
  proteinGoal: number
  carbsGoal: number
  fatGoal: number
  caloriesRemaining: number
  entryCount: number
  workoutFocus: string | null
  workoutStatus: WorkoutStatus | null
  exercisesCompleted: number
  exercisesTotal: number
  /** Where this day's goal came from, so a carried number can be labelled as such. */
  goalSource: GoalSource
  /** The date the goal was set on. Null when it came from the profile defaults. */
  goalSetOn: string | null
}
