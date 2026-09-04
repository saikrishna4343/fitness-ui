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
| `/timer` | Interval (HIIT) timer. Groups of exercises, each repeated for a number of rounds, with per-exercise work time, gaps, warm-up and cool-down — counted down out loud. |
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

### 4. Run

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
- **The interval timer is the one thing not in the database.** A timer config is a
  scratchpad you rewrite between sets, so it lives in localStorage — no schema, no policy,
  no migration. It is also the only screen that talks, via the browser's own speech
  synthesis: 3-2-1 through the last three seconds of every interval, then "start" going
  into an exercise and "rest easy" coming out of one.
- **Chart colours** are the `--chart-*` tokens in `src/index.css`. Both the light and dark
  sets were checked for colour-blind separation and contrast against their surface; the
  macro chart also ships a legend and a Table tab so identity is never colour-alone.
