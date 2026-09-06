# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev      # Vite dev server on :5173 (host: true — binds IPv4 and IPv6)
npm run build    # tsc -b && vite build
npm run lint     # oxlint (config in .oxlintrc.json)
npm run preview  # serve the production build
```

There is no test framework in this project — no test runner, no test files. `npm run build`
(which runs `tsc -b` first) and `npm run lint` are the only automated checks.

Environment: copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`. These are read at startup, so restart the dev server after
editing. With either missing, `src/lib/supabase.ts` silently swaps in the local auth shim
(`src/auth/localAuth.ts`) where any email/password signs in — a running app that stores
nothing is usually this.

## Architecture

**There is no application server.** The browser talks to Supabase directly: PostgREST for
CRUD, Postgres functions (RPC) for anything carrying logic, and row level security scopes
every query to the signed-in user. A Spring Boot service used to sit in the middle; the
leftovers of it are noted below.

```
browser  →  Supabase Auth (GoTrue)   sign-in, JWT, refresh
         →  PostgREST                tables + RPC, under the `fitness` schema
         →  Postgres + RLS           every policy tests auth.uid()
```

### `src/api/hooks.ts` is the only module that touches the network

Every page and component consumes TanStack Query hooks from this one file and never sees
supabase-js. Two rules hold throughout it, and new code must keep them:

1. **Nothing filters by user id.** RLS does it in the database on every query, including
   the ones nobody remembered to check. Adding a `.eq('user_id', ...)` here is a smell.
2. **Postgres is snake_case, the UI is camelCase.** The conversion happens in this file
   and nowhere else, via PostgREST select aliases (`sessionDate:session_date`), so
   `src/types/api.ts` stays free of database shapes.

`ok()` / `fail()` at the top of the file unwrap every supabase-js result into the single
`ApiError` shape the pages already handle. `data` is typed `unknown` on purpose: without
generated database types, supabase-js mistypes aliased selects.

Cache invalidation is centralised in `invalidateDay()` and `invalidateGoals()`. Goals carry
forward across dates, so a goal write invalidates the whole `['goals']` key, never one date.

### Server-side logic lives in Postgres functions

Reads and writes that are more than a row change are RPCs, not table writes — see
`supabase/03_api.sql` and `06_api_writes.sql`. Notable ones:

- `ensure_profile()`, `ensure_plan()`, `ensure_session(date)` — read-then-create. **The
  first read of a workout date is a write**: it materialises that day's session from the
  weekly plan.
- `tick_session_exercise(...)` — also stamps `completed_at` and lifts `PLANNED` →
  `IN_PROGRESS`. `useTickExercise` mirrors that status rule in its optimistic update, so
  the two must be changed together.
- `effective_goal(date)`, `daily_summary(from, to)` — goal carry-forward and per-day totals.
- `complete_workout` / `reopen_workout` / `skip_workout`, `reorder_*`.

A function returning a table's own row type (`ensure_profile()` returns
`fitness.user_profile`) must be recreated after that table gains a column, or the new column
never reaches PostgREST — which is why `12_birth_date.sql` says to re-run `03_api.sql`.

Changing behaviour usually means editing a SQL file **and** re-running it in the Supabase
SQL editor — the repo has no migration runner. `08_audit_columns.sql` is re-runnable and
loops over every table in the schema, which is how a new table picks up `status` and the
created/updated by-and-when columns; no other file lists them.

The schema files are numbered but **the numbering is not the run order** — the README's
setup table has the real one. `02_row_level_security.sql` goes **last**: applied before a
real JWT is in play, `auth.uid()` is null, every policy is false, and the database looks
wiped.

Everything is in the `fitness` schema, not `public`. It must be on the project's exposed
schema list (Dashboard → Integrations → Data API → Settings) or every request fails with
`PGRST106`; `fail()` translates that code into a message saying so.

### Domain rules worth knowing before changing anything

- **Sessions are snapshots.** A workout is copied from the plan the first time that date is
  opened and never re-read — editing the plan must not rewrite a workout already logged.
  "Load from plan" re-copies deliberately and refuses once anything is ticked.
- **Goals are date-scoped and carry forward.** A day with no goal of its own inherits the
  last one set, falling back to the profile defaults. Each day reports its `GoalSource` so
  a carried goal is never mistaken for one the user set.
- **Dates are the client's, not the server's.** The client sends a calendar date
  (`toIsoDate` in `src/lib/format.ts`) plus an ISO instant for time eaten, so a meal at
  11pm counts toward the right local day.

### The interval timer (`/timer`) is the exception to all of the above

It is the only feature with no server state: the config lives in localStorage
(`src/lib/timerStorage.ts`), which re-validates every field on load because that JSON
outlives deploys and a NaN would hang the clock on one phase forever.

- `src/lib/intervalPlan.ts` flattens a config into a flat `Phase[]` **once**, before the
  clock starts. Everything downstream — countdown, voice, skip, progress — reads that
  array, so seeking is a lookup and there is no nested round/exercise bookkeeping inside
  an interval callback. Phases carry forward-looking positions (a round rest reports the
  round it leads *into*), and zero-second phases are dropped at build time.
- `src/lib/useIntervalTimer.ts` derives elapsed time from a timestamp taken at the last
  start/resume, never by accumulating ticks — otherwise the voice and the clock drift
  apart over a long session. Voice cues fire from the sampled tick (guarded by refs so a
  re-render cannot repeat one), not from a render effect. It also holds a screen wake lock
  while running, re-acquired on `visibilitychange`.
- `src/lib/speech.ts` drives two outputs. Speech says what is happening; utterance volume
  is capped at 1 by the platform, so loudness comes from the Web Audio tones instead, which
  have real gain. `primeAudio()` must be called inside the user gesture that starts a
  session — iOS stays silent for the first cue otherwise, and an AudioContext built outside
  a gesture stays suspended — which is why both the page's Start button and the runner's
  call it. "Best available" is `PREFERRED_VOICE`, named outright — Google UK English
  Male, which Chrome ships and speaks over the network. Everything after it is ranked by
  name (`natural`/`neural`/`premium` up, `espeak`/`compact` down) because the API exposes
  no quality field; there is no voice picker and no stored
  preference -- `defaultSound` is passed straight to the runner, and `voiceURI: null`
  resolves to `PREFERRED_VOICE` (Google UK English Male) or the best ranked fallback.
- **The timer and today's workout are linked through `sessionExerciseId`** on each
  interval exercise (`src/lib/timerWorkout.ts`). It makes the sync idempotent, lets your
  timings survive a refresh from the workout, and is what the runner ticks against.
  Grouping is by **typed number** (`config.groupNumbers`, keyed by session exercise id):
  same number, same group, 0 to leave one out, applied by `breakIntoGroups()` when the
  button is pressed. The numbers are an intention held apart from the groups, so a whole
  list can be renumbered without the session rearranging mid-edit. A rebuild preserves
  per-exercise seconds, each group's rests, and any group the user built themselves.
  `syncFromWorkout()` only ever **adds and removes** — which group an exercise sits in is
  the user's, so an exercise already in the config is never relocated, and one taken out
  goes on `excludedExerciseIds` or the next merge would put it straight back. It is
  applied in a **`useMemo`, not an effect** — the
  config the page renders *is* the merge of storage and today's workout, so there is no
  second render and no copy to fall out of step; edits round-trip because the merge
  preserves per-exercise values by session id. `pushToWorkout()` in `Timer.tsx` pushes and is **awaited
  before the clock starts** — the runner freezes its plan at mount, so an id arriving a
  second later would never be ticked. The day is completed only when every workout
  exercise was covered by the plan.
- **`Phase.completesExercise`** marks the last work phase of an exercise (its final set,
  or its last round in a circuit). The runner fires `onExerciseDone` when that phase
  *ends*, which is when the next one begins — there is no phase-ended event, and waiting
  for the session would land the tick ten minutes after the effort.
- **Groups have a `style`**: `CIRCUIT` (round-robin, one round count for the group) or
  `SETS` (one exercise at a time, sets per exercise). Straight sets exist because a
  workout's per-exercise set counts cannot be expressed as a single group round count.
- The plan is frozen in a `useMemo` for the length of a session; editing mid-workout must
  not move phase boundaries under a running clock.
- Starting a session on a day with **no** exercises copies the intervals into today's
  workout (rounds → target sets, work seconds → target reps) and records that session id
  as `linkedWorkoutId`; finishing then calls `complete_workout` on it, which ticks every
  exercise server-side. A day that already has exercises is never touched, and never
  auto-completed. The fill is fired but not awaited — the countdown starts on the click.
- A running session snapshots `{config, elapsed, linkedWorkoutId}` to localStorage once a second, so a
  reload or a discarded background tab costs at most one second. It comes back **paused**
  at that point behind a Resume card, never running — the page has just reloaded and
  nobody is mid-burpee. The snapshot stores the config the session started with, expires
  after 6 hours, and is cleared on finish and on an explicit Stop (a decision, unlike an
  interruption).

### The coach (`/coach`) is the only server-side code

`supabase/functions/coach/` is a Deno edge function and the single reason this project has
any backend at all: the Anthropic API key cannot ship in the bundle. It is **outside
`tsc`'s scope** (`tsconfig.app.json` includes only `src`), so `npm run build` proves
nothing about it — run **`npm run coach:check`**, which type-checks it with Deno.

Check the **sources**, never `_bundle.ts`: esbuild strips type annotations, so Deno
re-infers everything in the bundle and reports dozens of errors that do not exist in the
code. `npm run coach:bundle` regenerates the bundle for the dashboard editor.

- **Two providers behind one seam** (`providers.ts`): `COACH_MODEL` picks the model and
  therefore the provider — `claude*` goes to `anthropic.ts`, anything else to
  `gemini.ts`. What makes the swap cheap is that replay is text-only, so no provider's
  content-block format ever reaches the database. Gemini does **not** stream here (its
  function-call arguments arrive as deltas to reassemble; guessing that wrong fails like
  a stupid model rather than a bug) and it has no prompt caching, so the system prompt is
  billed in full every turn. `simplifySchema()` strips the JSON Schema keywords Gemini
  rejects — it takes only type/properties/required/items/enum/description, and no union
  types.
- **The security model is the JWT, not the tool code.** The function builds its Supabase
  client from the caller's `Authorization` header, so every tool query runs as that user
  under existing RLS. There is no service-role key anywhere in it, and adding one would
  make the model's reach a matter of how carefully the tools were written.
- **Numbers are computed, words are generated.** `coach_targets()`, `daily_summary()`,
  `last_training_day()` and `training_history()` do the arithmetic; the model explains the
  result. The one sanctioned estimate is food macros from a description, and only after
  `search_saved_foods` misses.
- `last_training_day()` is the rest-day walk-back in one query, and counts a day as
  training only if an exercise was **completed** — so it cannot disagree with Progress.
- **History replay is text-only** (`replayable()` in `index.ts`): tool calls and their
  results are stripped before re-sending, capped at 12 messages and 12 hours. Tool results
  are both the expensive part — three weeks of training history is a page of JSON, billed
  again on every message since history sits *after* the cache breakpoint — and the part the
  model can re-fetch fresher for one tool call. The words stay because "add them to today"
  is meaningless without the message listing them. The table still stores everything; only
  the replay is trimmed.
- **Three write tools, and the difference between them is the point**: `log_food` (one or
  more foods on a date), `add_workout_exercises` (one date's session — `ensure_session`
  materialises a future day), `add_plan_exercises` (a weekday of the weekly template,
  which does *not* alter a workout already materialised). The prompt tells the model to
  ask when "add squats on Monday" is genuinely ambiguous.
- **The date comes from the browser**, sent on every request and carried as `ctx.today`.
  The function runs in UTC, which is already tomorrow from ~7pm Central — logging dinner
  to the wrong day would be a quiet, week-ruining bug. It is injected as a **second
  system block after the cache breakpoint**, so a string that changes daily never
  invalidates a prompt that does not.
- **`TOOLS` order is load-bearing.** Tools render before the system prompt in the cached
  prefix; reordering them costs a full cache miss on every request. Same for any edit to
  `prompt.ts` — one uncached request, then free.
- Writes run when asked for in words; `add_todays_exercises` appends by default and
  `replace` refuses once anything is ticked, matching "Load from plan".
- The conversation lives in `CoachConversation`, shared by `/coach` and the floating
  launcher in `AppShell` — one component, because two copies of a streaming chat would be
  two places for the scroll behaviour and the send guard to drift. The panel is the base
  `DialogContent` re-anchored to the right edge with tailwind-merge overrides, which keeps
  its focus trap, Escape handling and scroll lock rather than reimplementing them.
- `src/api/coach.ts` is the deliberate exception to "hooks.ts is the only module that
  touches the network": it streams SSE from the function, which is not a shape TanStack
  Query fits. The stored transcript beside it *is* a normal query.
- The profile's `goal` and `activity_level` values must match the check constraints in
  `01_schema.sql` exactly (`LOSE_WEIGHT`, `MODERATELY_ACTIVE`, ...). Settings, the
  constraint, and `coach_targets()` all read them.

### Frontend conventions

- `@/` aliases `src/` (Vite + tsconfig).
- shadcn/ui (new-york, slate, lucide) in `src/components/ui/` — generated; prefer
  regenerating over hand-editing. App components sit one level up in `src/components/`.
- Tailwind v4 via `@tailwindcss/vite`; there is no `tailwind.config`. Tokens, including the
  `--chart-*` colours, live in `src/index.css`. Both light and dark chart sets were chosen
  for colour-blind separation, and the macro chart carries a legend and a Table tab so
  identity is never colour-alone.
- Routing and the QueryClient are set up in `src/main.tsx`; `ProtectedRoute` gates every
  page except `/login` and `/signup`. Queries do not retry a 401.
- `src/lib/useDragReorder.ts` is hand-rolled on HTML5 drag events, handle-only. Touch fires
  no drag events — the up/down buttons beside the handle are the touch and keyboard path.

### Leftovers from the old backend

- `src/lib/api.ts` is an axios layer aimed at the retired `fitness-api`. Only `ApiError` is
  still imported from it; nothing calls `api.get`/`post`/etc.
- `main.tsx` unregisters a stale MSW service worker on boot. **There is no request mocking
  in this app** — a leftover worker silently intercepting requests hides real errors.
- `supabase/05_adopt_dev_data.sql` and `07_split_display_name.sql` are one-time migrations,
  not part of a fresh setup.

## Deploying

Static build on Cloudflare Pages: build `npm run build`, deploy `npx wrangler deploy`,
`NODE_VERSION=22` (Vite 8 needs it). The output directory and SPA fallback come from
`wrangler.jsonc` (`assets.directory`, `not_found_handling: "single-page-application"`) —
without the latter, a refresh on `/food` returns Cloudflare's 404. Do **not** add a
`public/_redirects` with `/* /index.html 200` on Cloudflare; wrangler rejects it as an
infinite loop and the deploy fails after a successful build. The two `VITE_` vars are
inlined at **build** time; miss them and the deployed app falls back to the local auth shim.
