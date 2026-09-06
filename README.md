# fitness-ui

Track your daily food and calorie intake, and follow an editable weekly workout plan that
you tick off as you go.

There is no application server. The browser talks to Supabase directly — PostgREST for
CRUD, Postgres functions for the parts that carry real logic — and row level security
scopes every query to the signed-in user.

- Vite + React 19 + TypeScript
- shadcn/ui on Tailwind CSS v4, light and dark
- TanStack Query for server state, react-hook-form + zod for forms, Recharts for the charts
- Supabase for auth and data

## How it fits together

```
browser  →  Supabase Auth (GoTrue)      sign-in, JWT, refresh
         →  PostgREST                   tables + RPC, under the `fitness` schema
         →  Postgres + RLS              every policy tests auth.uid()
```

`src/api/hooks.ts` is the only module that touches the network. Pages and components
consume hooks and never see Supabase, which is what made replacing the old Spring Boot
service a one-file change.

Two rules hold throughout that file:

- **Nothing filters by user id.** RLS does it, in the database, on every query — including
  the ones nobody remembered to check.
- **Postgres is snake_case, the UI is camelCase.** The conversion happens there and nowhere
  else, via PostgREST select aliases, so `src/types/api.ts` stays clean.

## Screens

| Route | What it does |
|---|---|
| `/` | Today at a glance: calorie ring against your goal, macro bars, and today's workout with a checkbox per exercise. |
| `/food` | The food log for any date. Entries grouped by meal, each showing the time you ate. Add, edit, delete, and set that day's goal. |
| `/workout` | The full workout for any date: tick exercises, record the weight and reps you actually did, add one-off exercises, complete or skip. |
| `/plan` | The weekly split. Set each day's focus, mark rest days, add/edit/reorder exercises. |
| `/timer` | Interval (HIIT) timer, wired to today's workout in both directions. Groups run as a circuit or as straight sets, with per-exercise work time, gaps, warm-up and cool-down — counted down out loud. |
| `/coach` | An AI coach for meals and training. It reads your own log to answer, and can add exercises to today's workout when you ask. The same conversation is a tap away from every other screen, from the button in the bottom right. |
| `/progress` | Calories and macros per day over 7/30/90 days, with a table view, plus streak and workout stats. |
| `/settings` | Your profile, default calorie and macro goals, and your saved-foods library. |

## Setup

### 1. The database

The schema, policies and functions are in `supabase/`. Run them in the Supabase SQL editor
**in this order** — the numbering is not the run order:

| Order | File | What it does |
|---|---|---|
| 1 | `01_schema.sql` | Tables |
| 2 | `08_audit_columns.sql` | `status` and the created/updated by-and-when columns, on every table |
| 3 | `09_indexes.sql` | Indexes for the paths `01_schema.sql` did not cover |
| 4 | `03_api.sql` | Read functions, grants, check constraints |
| 5 | `06_api_writes.sql` | Write functions: status transitions, `order_index` maintenance |
| 6 | `10_reorder_session_exercises.sql` | Move an exercise within one day's workout |
| 7 | `11_reopen_workout.sql` | Status derived from the ticks, and the undo for "complete" |
| 8 | `02_row_level_security.sql` | **Last.** Policies |

`08_audit_columns.sql` is also re-runnable on its own: it finds every table in the schema,
so a table added later picks up the same five columns and the same trigger by running it
again. Nothing else in the schema lists those columns.

Row level security goes last on purpose. Every policy tests `auth.uid()`; applied before
the browser is sending a real JWT, that is null, every policy evaluates false, and every
table looks empty. It reads exactly like the database was wiped.

`supabase/07_split_display_name.sql` is not part of setup either. It replaces the old
single `display_name` column with `first_name` / `last_name` on a database created before
that split, backfilling the existing names. Run it once, then re-run `03_api.sql`. A fresh
install gets both columns from `01_schema.sql` and must skip it.

`supabase/12_birth_date.sql` is not part of setup either. It adds `birth_date` to a
profile table created before that column existed. Run it once, then re-run `03_api.sql` --
`ensure_profile()` returns the table's own row type, so it has to be recreated before the
new column reaches the API. A fresh install gets the column from `01_schema.sql` and must
skip it.

`supabase/05_adopt_dev_data.sql` is not part of setup. It is a one-time migration kept for
reference, from when this app ran behind a Spring Boot service that hardcoded a single dev
user id — it moves those rows onto a real account. A fresh install has nothing to adopt.

### 2. Expose the schema

Everything lives in the `fitness` schema, not `public`. PostgREST only serves schemas on
the project's exposed list:

**Dashboard → Integrations → Data API → Settings → Exposed schemas → add `fitness` → Save.**

Skip this and every request fails with `PGRST106: Invalid schema: fitness`.

### 3. Environment

```sh
cp .env.example .env.local
```

```sh
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<Client API key — the anon/publishable one, never the service key>
```

Both come from **Project Settings → API**. Env vars are read at startup, so restart the
dev server after editing `.env.local`.

The anon key is meant to be public — it ships inside the JavaScript bundle and is readable
from DevTools on any deployed build. RLS is what protects the data, not the key. The
**service key** is the one that must never appear here: it bypasses every policy.

### 4. The coach (optional)

The `/coach` screen needs one server-side piece, because an Anthropic API key cannot
live in the browser bundle the way the anon key does. It is a Supabase Edge Function.

1. Run `supabase/13_coach.sql` in the SQL editor. It brings its own grants and policies.
2. Get a model API key and set which model answers:

   | Secret | Value |
   |---|---|
   | `COACH_MODEL` | `gemini-3.8-flash` (default), or any `claude-*` id |
   | `GEMINI_API_KEY` | from **aistudio.google.com -> Get API key**. Gemini has a free tier. |
   | `ANTHROPIC_API_KEY` | from **console.anthropic.com -> Settings -> API keys**, prepaid, and separate from a Claude.ai subscription -- a Pro plan does not include it. |

   Set only the key for the provider you are using. `COACH_MODEL` picks it: anything
   starting `claude` goes to Anthropic, everything else to Gemini. Switching provider is
   a secret change and a restart, not a code change.

   Free tiers usually reserve the right to train on what you send. This app sends your
   food log and your training history, so that is worth reading before choosing.
3. Deploy. The CLI is a dev dependency, so `npx` runs it -- do not install it globally
   with npm, which it refuses:

```sh
npx supabase login                                # opens a browser, once per machine
npx supabase link --project-ref <your-project-ref>   # the subdomain of your project URL
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase functions deploy coach
```

**Or deploy from the dashboard**, with no CLI at all: **Edge Functions -> Deploy a new
function -> via editor**, name it `coach`, and paste the contents of

```sh
npm run coach:bundle    # writes supabase/functions/coach/_bundle.ts
```

which is the three source files rolled into one, since the editor is easier to fill with a
single file. That bundle is generated and gitignored -- edit the three files and rebuild
it, never the bundle. The API key goes in **Edge Functions -> Secrets** as
`ANTHROPIC_API_KEY`.

The edge function is outside `tsc`'s scope, so `npm run build` says nothing about it.
Type-check it with `npm run coach:check`, which runs Deno's checker over the real
sources -- not over `_bundle.ts`, whose annotations esbuild has already stripped.

`supabase/config.toml` is committed; `supabase/.temp`, which records the project this
checkout is linked to, is not. Deploying does not need Docker -- that is only for
`supabase start`. Logs are under **Edge Functions -> coach -> Logs** in the dashboard, or
`npx supabase functions logs coach`.

The key goes in `supabase secrets`, never in `.env.local`. Anything prefixed `VITE_` is
inlined into the bundle at build time and is readable by anyone who opens DevTools.

Without the function deployed the rest of the app is unaffected: the Coach screen reports
that it is unreachable and nothing else changes.

### 5. Run

```sh
npm install
npm run dev
```

Open http://localhost:5173 and create an account. Your profile and a seven-day plan are
created on first load — every day starts as a rest day with no exercises, all editable
from the Plan screen.

## Scripts

```sh
npm run dev      # dev server on :5173
npm run build    # tsc -b && vite build
npm run lint     # oxlint
npm run preview  # serve the production build
```

## Deploying

Static build, so anything that serves files works. On Cloudflare Pages:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| `VITE_SUPABASE_URL` | your project URL |
| `VITE_SUPABASE_ANON_KEY` | your anon key |
| `NODE_VERSION` | `22` |

`NODE_VERSION` is not optional — Vite 8 needs a newer Node than the default build image.
The two `VITE_` values are read at **build** time and inlined into the bundle; miss them
and you get an app that loads but silently falls back to the local auth shim.

Afterwards, point Supabase at the deployment under **Authentication → URL Configuration**:
set **Site URL** to the deployed origin and add it to **Redirect URLs**. Confirmation and
password-reset emails are generated against Site URL, so leaving it on `localhost:5173`
sends production users to their own machine.

There is no output-directory field: `wrangler.jsonc` supplies it (`assets.directory`),
along with `not_found_handling: "single-page-application"`. That second setting is what
makes SPA routing work — React Router owns `/food`, `/workout` and the rest, none of which
are files, so without it a refresh or a shared link returns Cloudflare's 404 and the app
never boots to handle it.

Do **not** also add a `public/_redirects` with `/* /index.html 200`. Wrangler parses that
file and rejects the rule as an infinite loop, since `/index.html` itself matches `/*` —
the deploy fails after a successful build. On a host that isn't Cloudflare, that rule is
the right way to get the same behaviour.

## Notes

- **Dates are yours, not the server's.** The client sends the calendar date and an ISO
  instant for the time eaten, so a meal at 11pm counts towards the right day wherever you are.
- **Ticking is optimistic.** A checkbox flips immediately and rolls back if the request fails.
- **Goals are date-scoped and carry forward.** Set one for a day or a week; any later day
  with no goal of its own inherits the last one you set, falling back to the profile
  defaults in Settings. Each day reports where its number came from, so a carried goal is
  never mistaken for one you set.
- **Sessions are snapshots.** A workout is copied from the plan the first time you open
  that date, and never re-read — editing the plan must not rewrite a workout you already
  logged. "Load from plan" on the workout screen re-copies deliberately, and refuses once
  anything is ticked.
- **The timer and today's workout are the same workout.** Today's exercises are listed
  in the timer the moment you open it, in a table with a group number against each one.
  Type the numbers -- same number, same group; 0 leaves one out -- and press **Break into
  groups**. New groups start at 45s rest between sets, exercises and groups. They arrive
  with their sets and, where it has one, its interval;
  finish an exercise's last set and it is ticked on the Workout screen as you stand
  there. Anything you build in the timer that is not on today gets added when you press
  Start. The day is only marked complete when the timer actually covered all of it — a
  ten-minute circuit alongside a planned eight-lift day has not done those lifts. The
  switch on the timer turns the whole link off for a session you would rather not log.
- **A group runs as a circuit or as straight sets.** A circuit is every exercise once
  then round again; straight sets is one exercise at a time, all of its sets, then the
  next. The second shape exists because a workout of 5×5 squats and 3×15 calf raises
  cannot be described by one round count for the group.
- **The interval timer is the one thing not in the database.** A timer config is a
  scratchpad you rewrite between sets, so it lives in localStorage — no schema, no policy,
  no migration. It is also the only screen that talks, via the browser's own speech
  synthesis: 3-2-1 through the last three seconds of every interval, then "start" going
  into an exercise and "rest easy" coming out of one. A Web Audio beep lands on each
  boundary ahead of the words — speech volume is capped at 1 by the platform, so the tone
  is the part that carries across a room. The voice is Google UK English Male wherever
  the browser has it -- Chrome, mostly -- and the best-sounding voice the device offers
  everywhere else. There is nothing to configure; the only control is a mute toggle
  while a session is running.
- **On an empty day, the timer is the workout.** Start a session with nothing planned for
  today and the intervals are copied into today's workout — rounds become the target sets,
  the work time becomes the reps — and running the session to the end marks that workout
  complete. A day that already has exercises is left alone: a ten-minute interval session
  is not proof you did the eight lifts you had planned.
- **The coach can write to three places, and knows which is which.** "Log that" adds the
  foods to a day; "put these in tomorrow's workout" adds to that one date; "every Monday"
  edits the weekly plan instead. It asks when the difference is genuinely unclear. Today's
  date comes from your browser, not the server, so an evening meal is not logged to
  tomorrow.
- **The coach quotes numbers it did not invent.** Calorie targets, averages and the last
  training day are computed in Postgres and handed to the model to explain; the only thing
  it estimates is the macros of a food described in words, and only after searching your
  saved foods. It is capped at 40 messages a day, and every tool query runs under your own
  JWT, so row level security scopes what it can read exactly as it scopes the app.
- **A reloaded timer picks up where it was.** A running session is snapshotted every
  second, and comes back paused behind a Resume card rather than counting down at someone
  who has just reloaded the page. Stopping deliberately clears it; so does finishing.
- **Chart colours** are the `--chart-*` tokens in `src/index.css`. Both the light and dark
  sets were checked for colour-blind separation and contrast against their surface; the
  macro chart also ships a legend and a Table tab so identity is never colour-alone.
