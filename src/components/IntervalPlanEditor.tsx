import { Copy, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { mmss } from '@/lib/intervalPlan'
import { newExercise, newGroup, newId } from '@/lib/timerStorage'
import type { IntervalGroup, TimerConfig } from '@/types/timer'

/** Seconds a group takes: every round of work, the gaps inside it, and the gaps between. */
function groupSeconds(group: IntervalGroup): number {
  const work = group.exercises.reduce((total, exercise) => total + exercise.seconds, 0)
  const gaps = Math.max(0, group.exercises.length - 1) * group.restSeconds
  return group.rounds * (work + gaps) + Math.max(0, group.rounds - 1) * group.roundRestSeconds
}

/**
 * A number input for a duration or a count.
 *
 * An empty field is left alone rather than coerced: clearing the box to retype it would
 * otherwise snap to the minimum on the first keystroke, and the caret would land behind
 * the digit that just appeared.
 */
function NumberField({
  id,
  label,
  value,
  min = 0,
  max = 3600,
  step = 5,
  suffix,
  onChange,
}: {
  id: string
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={value}
          className={suffix ? 'pr-7 tabular-nums' : 'tabular-nums'}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (event.target.value === '' || Number.isNaN(next)) return
            onChange(Math.min(max, Math.max(min, Math.round(next))))
          }}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-2.5 grid place-items-center text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
  )
}

export function IntervalPlanEditor({
  config,
  onChange,
}: {
  config: TimerConfig
  onChange: (config: TimerConfig) => void
}) {
  function patch(next: Partial<TimerConfig>) {
    onChange({ ...config, ...next })
  }

  function patchGroup(id: string, next: Partial<IntervalGroup>) {
    patch({
      groups: config.groups.map((group) => (group.id === id ? { ...group, ...next } : group)),
    })
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <h2 className="text-base font-semibold">Around the workout</h2>
          <p className="text-sm text-muted-foreground">Set any of these to 0 to skip it.</p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <NumberField
            id="warmup"
            label="Warm up"
            suffix="s"
            value={config.warmupSeconds}
            onChange={(warmupSeconds) => patch({ warmupSeconds })}
          />
          <NumberField
            id="group-rest"
            label="Rest between groups"
            suffix="s"
            value={config.groupRestSeconds}
            onChange={(groupRestSeconds) => patch({ groupRestSeconds })}
          />
          <NumberField
            id="cooldown"
            label="Cool down"
            suffix="s"
            value={config.cooldownSeconds}
            onChange={(cooldownSeconds) => patch({ cooldownSeconds })}
          />
        </CardContent>
      </Card>

      {config.groups.map((group, groupIndex) => (
        <Card key={group.id}>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Input
                value={group.name}
                aria-label={`Name of group ${groupIndex + 1}`}
                className="h-9 max-w-56 font-medium"
                onChange={(event) => patchGroup(group.id, { name: event.target.value })}
              />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {mmss(groupSeconds(group))}
              </span>
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Duplicate ${group.name}`}
                onClick={() =>
                  patch({
                    groups: [
                      ...config.groups.slice(0, groupIndex + 1),
                      {
                        ...group,
                        id: newId(),
                        name: `${group.name} copy`,
                        // Fresh ids: sharing them would make editing one row edit both.
                        exercises: group.exercises.map((exercise) => ({
                          ...exercise,
                          id: newId(),
                        })),
                      },
                      ...config.groups.slice(groupIndex + 1),
                    ],
                  })
                }
              >
                <Copy className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-destructive"
                aria-label={`Delete ${group.name}`}
                onClick={() =>
                  patch({ groups: config.groups.filter((other) => other.id !== group.id) })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <NumberField
                id={`rounds-${group.id}`}
                label="Rounds (sets)"
                min={1}
                max={50}
                step={1}
                value={group.rounds}
                onChange={(rounds) => patchGroup(group.id, { rounds })}
              />
              <NumberField
                id={`rest-${group.id}`}
                label="Gap between exercises"
                suffix="s"
                value={group.restSeconds}
                onChange={(restSeconds) => patchGroup(group.id, { restSeconds })}
              />
              <NumberField
                id={`round-rest-${group.id}`}
                label="Rest between rounds"
                suffix="s"
                value={group.roundRestSeconds}
                onChange={(roundRestSeconds) => patchGroup(group.id, { roundRestSeconds })}
              />
            </div>

            <div className="space-y-2">
              {group.exercises.map((exercise, index) => (
                <div key={exercise.id} className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <Input
                    value={exercise.name}
                    placeholder={`Exercise ${index + 1}`}
                    aria-label={`Name of exercise ${index + 1} in ${group.name}`}
                    className="h-9"
                    onChange={(event) =>
                      patchGroup(group.id, {
                        exercises: group.exercises.map((other) =>
                          other.id === exercise.id ? { ...other, name: event.target.value } : other,
                        ),
                      })
                    }
                  />
                  <div className="relative w-24 shrink-0">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={3600}
                      step={5}
                      value={exercise.seconds}
                      aria-label={`Seconds for exercise ${index + 1} in ${group.name}`}
                      className="h-9 pr-7 tabular-nums"
                      onChange={(event) => {
                        const next = Number(event.target.value)
                        if (event.target.value === '' || Number.isNaN(next)) return
                        patchGroup(group.id, {
                          exercises: group.exercises.map((other) =>
                            other.id === exercise.id
                              ? { ...other, seconds: Math.min(3600, Math.max(1, Math.round(next))) }
                              : other,
                          ),
                        })
                      }}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-2.5 grid place-items-center text-xs text-muted-foreground">
                      s
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove exercise ${index + 1} from ${group.name}`}
                    onClick={() =>
                      patchGroup(group.id, {
                        exercises: group.exercises.filter((other) => other.id !== exercise.id),
                      })
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}

              {group.exercises.length === 0 && (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  No exercises yet — a group with none is skipped.
                </p>
              )}

              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() =>
                  patchGroup(group.id, { exercises: [...group.exercises, newExercise()] })
                }
              >
                <Plus className="size-4" />
                Add exercise
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <Button
        variant="outline"
        className="w-full gap-2"
        onClick={() => patch({ groups: [...config.groups, newGroup(config.groups.length)] })}
      >
        <Plus className="size-4" />
        Add group
      </Button>
    </div>
  )
}
