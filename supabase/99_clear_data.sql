-- Empties every table in the `fitness` schema. DESTRUCTIVE and not undoable.
--
-- Keeps the schema itself: tables, functions, policies and grants all survive,
-- so there is nothing to re-run afterwards. Only the rows go.
--
-- It does NOT touch auth.users -- your login still works. Sign in after running
-- this and ensure_profile() / ensure_plan() rebuild the profile and plan rows on
-- the first page load, with the column defaults from 01_schema.sql. The profile
-- name comes back from the sign-up metadata; goals return to 2000 kcal.
--
-- Run it in the Supabase SQL editor, which connects as the table owner. The
-- browser's anon/authenticated role cannot truncate, by design.
--
-- Everything below is one statement on purpose: `cascade` follows the foreign
-- keys (plan -> plan_day -> plan_exercise, workout_session -> session_exercise)
-- and one statement means one transaction -- it either all empties or none does.

truncate table
    fitness.session_exercise,
    fitness.workout_session,
    fitness.plan_exercise,
    fitness.plan_day,
    fitness.plan,
    fitness.food_entry,
    fitness.food,
    fitness.daily_goal,
    fitness.user_profile
cascade;

-- Confirm. Every count should be 0.
select 'user_profile'     as table_name, count(*) from fitness.user_profile
union all select 'daily_goal',           count(*) from fitness.daily_goal
union all select 'food',                 count(*) from fitness.food
union all select 'food_entry',           count(*) from fitness.food_entry
union all select 'plan',                 count(*) from fitness.plan
union all select 'plan_day',             count(*) from fitness.plan_day
union all select 'plan_exercise',        count(*) from fitness.plan_exercise
union all select 'workout_session',      count(*) from fitness.workout_session
union all select 'session_exercise',     count(*) from fitness.session_exercise
order by table_name;
