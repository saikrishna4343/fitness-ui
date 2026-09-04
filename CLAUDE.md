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
