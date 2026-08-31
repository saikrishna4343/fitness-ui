-- Row level security -- RUNS LAST, despite the 02 in the filename.
--
-- Order is 01_schema -> 03_api -> sign in for real -> migrate your rows -> this.
--
-- Why it must be last: every policy below tests `auth.uid()`. Applied before the
-- browser is sending a real Supabase JWT, auth.uid() is null, every policy
-- evaluates false, and every table looks empty. It will look like the database
-- was wiped.
--
-- The precondition this file has always waited for is now met. With Spring Boot
-- gone, the browser talks to PostgREST as the `authenticated` role carrying the
-- user's JWT -- so unlike the old setup, these policies are actually enforced.
--
-- Two things to know:
--
--   1. RLS is bypassed by the table owner and by any superuser. Queries you run
--      in the Supabase SQL editor ignore all of it; that is expected, and is how
--      you fix your own data if a policy locks you out.
--   2. This is now the FIRST line of defence, not the second. There is no service
--      layer filtering by user id any more -- these policies are the only thing
--      standing between one user's rows and another's. Do not skip this file.
--
-- One row per user is assumed throughout: a table with user_id owns itself, and a
-- child table inherits ownership through its parent.

-- Safe to re-run. `enable row level security` is idempotent, and every policy is
-- dropped before it is recreated -- CREATE POLICY errors on an existing name, which
-- would otherwise abort the script partway and leave half the tables updated.
--
-- Re-running matters: an earlier version of this file was missing the `with check`
-- clauses on the three child tables further down, which silently denied every INSERT.

alter table fitness.user_profile     enable row level security;
alter table fitness.daily_goal       enable row level security;
alter table fitness.food             enable row level security;
alter table fitness.food_entry       enable row level security;
alter table fitness.plan             enable row level security;
alter table fitness.workout_session  enable row level security;

drop policy if exists own_profile     on fitness.user_profile;
create policy own_profile on fitness.user_profile
    using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_daily_goals on fitness.daily_goal;
create policy own_daily_goals on fitness.daily_goal
    using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_food        on fitness.food;
create policy own_food on fitness.food
    using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_entries     on fitness.food_entry;
create policy own_entries on fitness.food_entry
    using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_plan        on fitness.plan;
create policy own_plan on fitness.plan
    using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_sessions    on fitness.workout_session;
create policy own_sessions on fitness.workout_session
    using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Child tables carry no user_id -- they inherit ownership through their parent.

alter table fitness.plan_day         enable row level security;
alter table fitness.plan_exercise    enable row level security;
alter table fitness.session_exercise enable row level security;

-- Each of these needs BOTH clauses. `using` governs which rows are visible to
-- SELECT, UPDATE and DELETE; `with check` governs what an INSERT or UPDATE is
-- allowed to write. A policy with only `using` silently denies every INSERT.
--
-- That was invisible under the old architecture -- Spring connected as the table
-- owner and bypassed RLS -- but the browser now inserts these rows directly, so
-- "Add exercise" on the Plan and Workout pages depends on the check clauses.

drop policy if exists own_plan_days on fitness.plan_day;
create policy own_plan_days on fitness.plan_day
    using (exists (select 1
                   from fitness.plan p
                   where p.id = plan_day.plan_id
                     and p.user_id = auth.uid()))
    with check (exists (select 1
                        from fitness.plan p
                        where p.id = plan_day.plan_id
                          and p.user_id = auth.uid()));

drop policy if exists own_plan_exercises on fitness.plan_exercise;
create policy own_plan_exercises on fitness.plan_exercise
    using (exists (select 1
                   from fitness.plan_day d
                            join fitness.plan p on p.id = d.plan_id
                   where d.id = plan_exercise.plan_day_id
                     and p.user_id = auth.uid()))
    with check (exists (select 1
                        from fitness.plan_day d
                                 join fitness.plan p on p.id = d.plan_id
                        where d.id = plan_exercise.plan_day_id
                          and p.user_id = auth.uid()));

drop policy if exists own_session_exercises on fitness.session_exercise;
create policy own_session_exercises on fitness.session_exercise
    using (exists (select 1
                   from fitness.workout_session s
                   where s.id = session_exercise.session_id
                     and s.user_id = auth.uid()))
    with check (exists (select 1
                        from fitness.workout_session s
                        where s.id = session_exercise.session_id
                          and s.user_id = auth.uid()));
