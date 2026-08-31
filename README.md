# fitness-ui

Track your daily food and calorie intake, and follow an editable weekly workout plan that
you tick off as you go.

- Vite + React 19 + TypeScript
- shadcn/ui on Tailwind CSS v4, light and dark
- TanStack Query for server state, react-hook-form + zod for forms, Recharts for the charts
- Supabase Auth for sign-up/sign-in; all data goes through [`fitness-api`](../fitness-api)

## Screens

| Route | What it does |
|---|---|
| `/` | Today at a glance: calorie ring against your goal, macro bars, and today's workout with a checkbox per exercise. |
| `/food` | The food log for any date. Entries grouped by meal, each showing the time you ate. Add, edit, delete. |
| `/workout` | The full workout for any date: tick exercises, record the weight and reps you actually did, complete or skip. |
| `/plan` | The weekly split. Set each day's focus, mark rest days, add/edit/reorder exercises. |
| `/progress` | Calories and macros per day over 7/30/90 days, with a table view, plus streak and workout stats. |
| `/settings` | Your profile, calorie and macro goals, and your saved-foods library. |

## Running without a backend (mock mode)

`fitness-api` and Supabase are not required to work on the UI. With mock mode on, a
Mock Service Worker answers every API call from a generated dataset — a full profile,
a 5-day training split, and ~120 days of food and workout history — and auth is stubbed
so you land straight on the dashboard.

```sh
echo "VITE_USE_MOCKS=true" > .env.local
npm run dev
```

- **Env vars are read at startup** — restart the dev server after changing `.env.local`.
- You start signed in. Sign out works, and any email/password signs you back in.
- Writes (logging food, ticking exercises, editing the plan) mutate an in-memory store,
  so they behave like a real backend until you reload.
- Requests show up in the Network tab as normal; unhandled ones warn in the console.

Everything lives in `src/mocks/`. To switch to the real backend, set `VITE_USE_MOCKS=false`
and fill in the Supabase values below. To remove mock mode entirely, delete `src/mocks/`
and `public/mockServiceWorker.js`, then drop the `enableMocks()` block in `src/main.tsx`
and the `useMocks` branch in `src/lib/supabase.ts`.

## Setup

1. Get [`fitness-api`](../fitness-api/README.md) running first — it owns the database.
2. Copy the env template and fill it in from Supabase → Project Settings → API:

   ```sh
   cp .env.example .env.local
   ```

   ```sh
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon public key>
   VITE_API_BASE_URL=http://localhost:8080
   ```

   The app throws a clear error on start if these are missing.

3. Install and run:

   ```sh
   npm install
   npm run dev
   ```

Open http://localhost:5173, create an account, confirm the email Supabase sends, and sign in.
Your profile and a starting weekly split (Mon Chest, Tue Shoulders & Back, Wed Deadlift,
Thu Arms, Fri Legs, Sat Cardio & Core, Sun Rest) are created on first load — all editable
from the Plan screen.

## Scripts

```sh
npm run dev      # dev server on :5173
npm run build    # tsc -b && vite build
npm run lint     # oxlint
npm run preview  # serve the production build
```

## Notes

- **Dates are yours, not the server's.** The client sends the calendar date and an ISO
  instant for the time eaten, so a meal at 11pm counts towards the right day wherever you are.
- **Ticking is optimistic.** A checkbox flips immediately and rolls back if the request fails.
- **Chart colours** are the `--chart-*` tokens in `src/index.css`. Both the light and dark
  sets were checked for colour-blind separation and contrast against their surface; the
  macro chart also ships a legend and a Table tab so identity is never colour-alone.
