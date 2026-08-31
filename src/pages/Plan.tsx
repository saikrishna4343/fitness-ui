import { ArrowDown, ArrowUp, Check, GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  useAddPlanExercise,
  useDeletePlanExercise,
  usePlan,
  useReorderPlanExercises,
  useUpdatePlanDay,
  useUpdatePlanExercise,
} from '@/api/hooks'
import { PageHeader } from '@/components/AppShell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useDragReorder } from '@/lib/useDragReorder'
import { cn } from '@/lib/utils'
import type { PlanDay, PlanExercise } from '@/types/api'

export default function Plan() {
  const { data: plan, isLoading } = usePlan()

  return (
    <>
      <PageHeader
        title="Weekly plan"
        description="Set the focus and exercises for each day. Today's workout is built from this."
      />

      {isLoading || !plan ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <div className="space-y-4">
          {plan.days.map((day) => (
            <DayCard key={day.id} day={day} />
          ))}
        </div>
      )}
    </>
  )
}

function DayCard({ day }: { day: PlanDay }) {
  const [editingFocus, setEditingFocus] = useState(false)
  const [focus, setFocus] = useState(day.focus)
  const [adding, setAdding] = useState(false)

  const updateDay = useUpdatePlanDay()
  const addExercise = useAddPlanExercise()
  const reorder = useReorderPlanExercises()

  function saveDay(next: { focus?: string; restDay?: boolean }) {
    updateDay.mutate(
      {
        dayOfWeek: day.dayOfWeek,
        body: {
          focus: next.focus ?? day.focus,
          restDay: next.restDay ?? day.restDay,
          notes: day.notes,
        },
      },
      { onError: (error) => toast.error(error.message) },
    )
  }

  const ids = day.exercises.map((exercise) => exercise.id)

  function save(nextIds: string[]) {
    reorder.mutate({ dayOfWeek: day.dayOfWeek, exerciseIds: nextIds })
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...ids]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    save(next)
  }

  const drag = useDragReorder(ids, save)

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CardTitle className="text-base">{day.dayName}</CardTitle>
          {editingFocus ? (
            <div className="flex items-center gap-1">
              <Input
                value={focus}
                autoFocus
                className="h-8 w-44"
                onChange={(event) => setFocus(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    saveDay({ focus })
                    setEditingFocus(false)
                  }
                  if (event.key === 'Escape') {
                    setFocus(day.focus)
                    setEditingFocus(false)
                  }
                }}
              />
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={() => {
                  saveDay({ focus })
                  setEditingFocus(false)
                }}
              >
                <Check className="size-4" />
                <span className="sr-only">Save focus</span>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={() => {
                  setFocus(day.focus)
                  setEditingFocus(false)
                }}
              >
                <X className="size-4" />
                <span className="sr-only">Cancel</span>
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditingFocus(true)}
              className="group flex items-center gap-1.5"
            >
              <Badge variant={day.restDay ? 'outline' : 'secondary'}>{day.focus}</Badge>
              <Pencil className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor={`rest-${day.id}`} className="text-xs font-normal text-muted-foreground">
            Rest day
          </Label>
          <Switch
            id={`rest-${day.id}`}
            checked={day.restDay}
            onCheckedChange={(checked) => saveDay({ restDay: checked })}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {day.restDay ? (
          <p className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
            Marked as a rest day.
          </p>
        ) : (
          <>
            {day.exercises.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
                No exercises yet.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {day.exercises.map((exercise, index) => (
                  <ExerciseRow
                    key={exercise.id}
                    exercise={exercise}
                    isFirst={index === 0}
                    isLast={index === day.exercises.length - 1}
                    onMoveUp={() => move(index, -1)}
                    onMoveDown={() => move(index, 1)}
                    drag={drag}
                    isDropBelow={ids.indexOf(drag.dragging ?? '') < index}
                  />
                ))}
              </ul>
            )}

            {adding ? (
              <ExerciseForm
                onCancel={() => setAdding(false)}
                onSubmit={(body) =>
                  addExercise.mutate(
                    { dayOfWeek: day.dayOfWeek, body },
                    {
                      onSuccess: () => setAdding(false),
                      onError: (error) => toast.error(error.message),
                    },
                  )
                }
              />
            ) : (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setAdding(true)}>
                <Plus className="size-4" />
                Add exercise
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function ExerciseRow({
  exercise,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  drag,
  isDropBelow,
}: {
  exercise: PlanExercise
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  drag: ReturnType<typeof useDragReorder>
  isDropBelow: boolean
}) {
  const [editing, setEditing] = useState(false)
  const update = useUpdatePlanExercise()
  const remove = useDeletePlanExercise()

  if (editing) {
    return (
      <li className="p-3">
        <ExerciseForm
          initial={exercise}
          onCancel={() => setEditing(false)}
          onSubmit={(body) =>
            update.mutate(
              { id: exercise.id, body },
              { onSuccess: () => setEditing(false), onError: (error) => toast.error(error.message) },
            )
          }
        />
      </li>
    )
  }

  return (
    <li
      ref={drag.rowRef(exercise.id)}
      {...drag.rowProps(exercise.id)}
      className={cn(
        'flex items-center gap-2 px-3 py-2.5 transition-colors',
        drag.dragging === exercise.id && 'opacity-40',
        drag.over === exercise.id &&
          (isDropBelow ? 'border-b-2 border-b-primary' : 'border-t-2 border-t-primary'),
      )}
    >
      <span
        {...drag.handleProps(exercise.id)}
        aria-hidden
        className="-ml-1 cursor-grab text-muted-foreground/50 transition-colors hover:text-muted-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{exercise.name}</p>
        <p className="text-xs text-muted-foreground">
          {exercise.targetSets} x {exercise.targetReps}
          {exercise.targetWeightKg != null && ` @ ${exercise.targetWeightKg} kg`}
        </p>
      </div>

      <Button variant="ghost" size="icon" className="size-8" disabled={isFirst} onClick={onMoveUp}>
        <ArrowUp className="size-4" />
        <span className="sr-only">Move up</span>
      </Button>
      <Button variant="ghost" size="icon" className="size-8" disabled={isLast} onClick={onMoveDown}>
        <ArrowDown className="size-4" />
        <span className="sr-only">Move down</span>
      </Button>
      <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(true)}>
        <Pencil className="size-4" />
        <span className="sr-only">Edit {exercise.name}</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={() =>
          remove.mutate(exercise.id, {
            onSuccess: () => toast.success('Exercise removed'),
            onError: (error) => toast.error(error.message),
          })
        }
      >
        <Trash2 className="size-4 text-destructive" />
        <span className="sr-only">Delete {exercise.name}</span>
      </Button>
    </li>
  )
}

function ExerciseForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: PlanExercise
  onSubmit: (body: {
    name: string
    targetSets: number
    targetReps: string
    targetWeightKg: number | null
  }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [sets, setSets] = useState(String(initial?.targetSets ?? 3))
  const [reps, setReps] = useState(initial?.targetReps ?? '8-12')
  const [weight, setWeight] = useState(initial?.targetWeightKg?.toString() ?? '')

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!name.trim()) {
          toast.error('Give the exercise a name')
          return
        }
        onSubmit({
          name: name.trim(),
          targetSets: Number(sets) || 3,
          targetReps: reps.trim() || '8-12',
          targetWeightKg: weight === '' ? null : Number(weight),
        })
      }}
    >
      <div className="min-w-40 flex-1 space-y-1">
        <Label className="text-xs">Exercise</Label>
        <Input value={name} autoFocus onChange={(event) => setName(event.target.value)} className="h-9" />
      </div>
      <div className="w-20 space-y-1">
        <Label className="text-xs">Sets</Label>
        <Input
          type="number"
          min="1"
          value={sets}
          onChange={(event) => setSets(event.target.value)}
          className="h-9"
        />
      </div>
      <div className="w-24 space-y-1">
        <Label className="text-xs">Reps</Label>
        <Input value={reps} onChange={(event) => setReps(event.target.value)} className="h-9" />
      </div>
      <div className="w-24 space-y-1">
        <Label className="text-xs">Weight kg</Label>
        <Input
          type="number"
          step="0.5"
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          className="h-9"
          placeholder="—"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
