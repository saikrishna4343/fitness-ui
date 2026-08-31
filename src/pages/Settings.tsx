import { Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useDeleteFood, useFoods, useProfile, useUpdateProfile } from '@/api/hooks'
import { PageHeader } from '@/components/AppShell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import type { Profile } from '@/types/api'

const GOALS = [
  { value: 'LOSE', label: 'Lose weight' },
  { value: 'MAINTAIN', label: 'Maintain' },
  { value: 'GAIN', label: 'Gain muscle' },
]

const ACTIVITY = [
  { value: 'SEDENTARY', label: 'Sedentary' },
  { value: 'LIGHT', label: 'Lightly active' },
  { value: 'MODERATE', label: 'Moderately active' },
  { value: 'ACTIVE', label: 'Very active' },
]

export default function Settings() {
  const { data: profile, isLoading } = useProfile()

  return (
    <>
      <PageHeader title="Settings" description="Your details, goals, and saved foods." />

      {isLoading || !profile ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="space-y-4">
          <ProfileForm key={profile.userId} profile={profile} />
          <SavedFoods />
        </div>
      )}
    </>
  )
}

function ProfileForm({ profile }: { profile: Profile }) {
  const update = useUpdateProfile()
  const [form, setForm] = useState(profile)

  function set<K extends keyof Profile>(key: K, value: Profile[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    update.mutate(
      {
        firstName: form.firstName,
        lastName: form.lastName,
        sex: form.sex,
        heightCm: form.heightCm,
        weightKg: form.weightKg,
        activityLevel: form.activityLevel,
        goal: form.goal,
        dailyCalorieGoal: Number(form.dailyCalorieGoal),
        proteinGoal: Number(form.proteinGoal),
        carbsGoal: Number(form.carbsGoal),
        fatGoal: Number(form.fatGoal),
      },
      {
        onSuccess: () => toast.success('Settings saved'),
        onError: (error) => toast.error(error.message),
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile and goals</CardTitle>
        <CardDescription>
          Your calorie goal drives the ring on the dashboard and the reference line on the charts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="first-name">
              <Input
                id="first-name"
                autoComplete="given-name"
                value={form.firstName ?? ''}
                onChange={(event) => set('firstName', event.target.value)}
              />
            </Field>
            <Field label="Last name" htmlFor="last-name">
              <Input
                id="last-name"
                autoComplete="family-name"
                value={form.lastName ?? ''}
                onChange={(event) => set('lastName', event.target.value)}
              />
            </Field>
            <Field label="Sex" htmlFor="sex">
              <Input
                id="sex"
                placeholder="Optional"
                value={form.sex ?? ''}
                onChange={(event) => set('sex', event.target.value)}
              />
            </Field>
            <Field label="Height (cm)" htmlFor="height">
              <Input
                id="height"
                type="number"
                step="0.5"
                value={form.heightCm ?? ''}
                onChange={(event) => set('heightCm', event.target.value === '' ? null : Number(event.target.value))}
              />
            </Field>
            <Field label="Weight (kg)" htmlFor="weight">
              <Input
                id="weight"
                type="number"
                step="0.1"
                value={form.weightKg ?? ''}
                onChange={(event) => set('weightKg', event.target.value === '' ? null : Number(event.target.value))}
              />
            </Field>
            <Field label="Goal" htmlFor="goal">
              <Select value={form.goal} onValueChange={(value) => set('goal', value)}>
                <SelectTrigger id="goal" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GOALS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Activity level" htmlFor="activity">
              <Select value={form.activityLevel} onValueChange={(value) => set('activityLevel', value)}>
                <SelectTrigger id="activity" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVITY.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-medium">Default goals</h3>
            <p className="text-xs text-muted-foreground">
              Used until a day has a goal of its own. Set a goal for a specific day or week
              from the Food log, and later days inherit it from there.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Calories / day" htmlFor="calorie-goal">
              <Input
                id="calorie-goal"
                type="number"
                value={form.dailyCalorieGoal}
                onChange={(event) => set('dailyCalorieGoal', Number(event.target.value))}
              />
            </Field>
            <Field label="Protein (g)" htmlFor="protein-goal">
              <Input
                id="protein-goal"
                type="number"
                value={form.proteinGoal}
                onChange={(event) => set('proteinGoal', Number(event.target.value))}
              />
            </Field>
            <Field label="Carbs (g)" htmlFor="carbs-goal">
              <Input
                id="carbs-goal"
                type="number"
                value={form.carbsGoal}
                onChange={(event) => set('carbsGoal', Number(event.target.value))}
              />
            </Field>
            <Field label="Fat (g)" htmlFor="fat-goal">
              <Input
                id="fat-goal"
                type="number"
                value={form.fatGoal}
                onChange={(event) => set('fatGoal', Number(event.target.value))}
              />
            </Field>
          </div>

          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save settings'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function SavedFoods() {
  const { data: foods = [] } = useFoods('')
  const remove = useDeleteFood()

  return (
    <Card>
      <CardHeader>
        <CardTitle>My foods</CardTitle>
        <CardDescription>
          Foods you saved while logging. They autocomplete in the log-food dialog.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {foods.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            No saved foods yet. Tick &ldquo;Save to my foods&rdquo; when you log something you eat often.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {foods.map((food) => (
              <li key={food.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{food.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {food.servingSize} {food.servingUnit} · {food.calories} kcal
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() =>
                    remove.mutate(food.id, {
                      onSuccess: () => toast.success('Removed from my foods'),
                      onError: (error) => toast.error(error.message),
                    })
                  }
                >
                  <Trash2 className="size-4 text-destructive" />
                  <span className="sr-only">Delete {food.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}
