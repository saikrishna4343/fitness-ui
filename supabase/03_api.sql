-- fitness-api, replaced.
--
-- This file is what makes the Spring Boot service unnecessary. Every endpoint that
-- was pure CRUD is now handled by PostgREST directly against the tables; only the
-- four pieces that carried real logic needed code, and they are the four functions
-- below. Run this AFTER 01_schema.sql. Row level security
-- (02_row_level_security.sql) runs LAST, despite its number -- see its header.
--
--   Java service                        ->  what replaces it
--   ------------------------------------------------------------------------
--   ProfileService.getOrCreate          ->  fitness.ensure_profile()
--   GoalService.on / .over              ->  fitness.effective_goal / .daily_summary
--   SummaryService.range                ->  fitness.daily_summary()
--   PlanService.getOrCreate             ->  fitness.ensure_plan()
--   WorkoutService.getOrMaterialise     ->  fitness.ensure_session()
--   everything else (~16 endpoints)     ->  PostgREST on the tables
--
-- Every function is SECURITY INVOKER (the default) and filters on auth.uid(), so
-- once 04_rls.sql is applied they are safe to expose: a caller can only ever reach
-- their own rows, whatever arguments they pass.

-- ---------------------------------------------------------------- exposure
--
-- PostgREST only serves schemas listed in the project's exposed-schemas setting.
-- Add `fitness` there too:
--   Dashboard -> Project Settings -> API -> Exposed schemas -> add "fitness"
-- Without that step every request below returns "The schema must be one of the
-- following: public, graphql_public".

grant usage on schema fitness to anon, authenticated;

grant select, insert, update, delete on all tables in schema fitness to authenticated;
grant usage, select on all sequences in schema fitness to authenticated;

-- Anything created later inherits the same grants, so a new table is not a silent
-- 401 six months from now.
alter default privileges in schema fitness
    grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema fitness
    grant usage, select on sequences to authenticated;


-- ---------------------------------------------------------------- profile

-- Replaces ProfileService.getOrCreate. The UI has no onboarding step, so a brand
-- new user must come out of one call with usable goals -- the column defaults in
-- 01_schema.sql supply them.
create or replace function fitness.ensure_profile()
returns fitness.user_profile
language plpgsql
as $$
declare
    result fitness.user_profile;
begin
    insert into fitness.user_profile (user_id)
    values (auth.uid())
    on conflict (user_id) do nothing;

    select * into result from fitness.user_profile where user_id = auth.uid();
    return result;
end;
$$;


-- ---------------------------------------------------------------- goals

-- The carry-forward rule, unchanged from GoalService: the row for the exact date
-- when one exists, else the most recent earlier row, else the profile defaults.
--
-- The lateral join IS the rule -- `goal_date <= p_date order by goal_date desc
-- limit 1` returns an exact match first because an exact match sorts first.
create or replace function fitness.effective_goal(p_date date)
returns table (
    date               date,
    daily_calorie_goal integer,
    protein_goal       integer,
    carbs_goal         integer,
    fat_goal           integer,
    source             text,
    set_on             date
)
language sql
stable
as $$
    select p_date,
           coalesce(g.daily_calorie_goal, p.daily_calorie_goal),
           coalesce(g.protein_goal,       p.protein_goal),
           coalesce(g.carbs_goal,         p.carbs_goal),
           coalesce(g.fat_goal,           p.fat_goal),
           case
               when g.goal_date = p_date   then 'EXPLICIT'
               when g.goal_date is not null then 'CARRIED'
               else                              'DEFAULT'
           end,
           g.goal_date
      from fitness.user_profile p
      left join lateral (
           select d.*
             from fitness.daily_goal d
            where d.user_id = p.user_id
              and d.goal_date <= p_date
            order by d.goal_date desc
            limit 1
      ) g on true
     where p.user_id = auth.uid();
$$;


-- Sets every day of the week containing p_date. Normalised to Monday, matching
-- plan_day.day_of_week where 1 is already Monday.
create or replace function fitness.set_week_goal(
    p_date     date,
    p_calories integer,
    p_protein  integer,
    p_carbs    integer,
    p_fat      integer
)
returns setof fitness.daily_goal
language sql
as $$
    insert into fitness.daily_goal
        (user_id, goal_date, daily_calorie_goal, protein_goal, carbs_goal, fat_goal)
    select auth.uid(),
           d::date,
           p_calories, p_protein, p_carbs, p_fat
      from generate_series(
               date_trunc('week', p_date)::date,
               date_trunc('week', p_date)::date + 6,
               interval '1 day') d
    on conflict (user_id, goal_date) do update
        set daily_calorie_goal = excluded.daily_calorie_goal,
            protein_goal       = excluded.protein_goal,
            carbs_goal         = excluded.carbs_goal,
            fat_goal           = excluded.fat_goal,
            updated_at         = now()
    returning *;
$$;


-- ---------------------------------------------------------------- summary

-- Replaces SummaryService.range: one row per day, both ends inclusive, zero-filled
-- so the Progress chart draws a continuous line, with each day carrying the goal
-- that was in force FOR THAT DAY rather than today's profile value.
create or replace function fitness.daily_summary(p_from date, p_to date)
returns table (
    date                date,
    calories            integer,
    protein_g           numeric,
    carbs_g             numeric,
    fat_g               numeric,
    calorie_goal        integer,
    protein_goal        integer,
    carbs_goal          integer,
    fat_goal            integer,
    calories_remaining  integer,
    entry_count         integer,
    workout_focus       text,
    workout_status      text,
    exercises_completed integer,
    exercises_total     integer,
    goal_source         text,
    goal_set_on         date
)
language sql
stable
as $$
    with prof as (
        select * from fitness.user_profile where user_id = auth.uid()
    ),
    days as (
        select d::date as date from generate_series(p_from, p_to, interval '1 day') d
    ),
    food as (
        select entry_date,
               sum(calories)::integer as calories,
               sum(protein_g)         as protein_g,
               sum(carbs_g)           as carbs_g,
               sum(fat_g)             as fat_g,
               count(*)::integer      as entry_count
          from fitness.food_entry
         where user_id = auth.uid()
           and entry_date between p_from and p_to
         group by entry_date
    ),
    -- left join, not join: a rest day has zero exercises and an inner join would
    -- drop it from the result, losing its status.
    sess as (
        select s.session_date,
               s.focus,
               s.rest_day,
               s.status,
               count(x.*) filter (where x.completed)::integer as completed_count,
               count(x.*)::integer                           as total_count
          from fitness.workout_session s
          left join fitness.session_exercise x on x.session_id = s.id
         where s.user_id = auth.uid()
           and s.session_date between p_from and p_to
         group by s.id, s.session_date, s.focus, s.rest_day, s.status
    )
    select days.date,
           coalesce(food.calories, 0),
           round(coalesce(food.protein_g, 0), 1),
           round(coalesce(food.carbs_g,   0), 1),
           round(coalesce(food.fat_g,     0), 1),
           coalesce(g.daily_calorie_goal, prof.daily_calorie_goal),
           coalesce(g.protein_goal,       prof.protein_goal),
           coalesce(g.carbs_goal,         prof.carbs_goal),
           coalesce(g.fat_goal,           prof.fat_goal),
           -- Goes negative on purpose: the UI renders that as over budget.
           coalesce(g.daily_calorie_goal, prof.daily_calorie_goal)
               - coalesce(food.calories, 0),
           coalesce(food.entry_count, 0),
           -- Null on a rest day, even though the session still carries a focus.
           case when sess.rest_day then null else sess.focus end,
           sess.status,
           coalesce(sess.completed_count, 0),
           coalesce(sess.total_count, 0),
           case
               when g.goal_date = days.date  then 'EXPLICIT'
               when g.goal_date is not null  then 'CARRIED'
               else                               'DEFAULT'
           end,
           g.goal_date
      from days
      cross join prof
      left join food on food.entry_date   = days.date
      left join sess on sess.session_date = days.date
      left join lateral (
           select d.*
             from fitness.daily_goal d
            where d.user_id = prof.user_id
              and d.goal_date <= days.date
            order by d.goal_date desc
            limit 1
      ) g on true
     order by days.date;
$$;


-- ---------------------------------------------------------------- plan

-- Replaces PlanService.getOrCreate. All seven days are created, not just the ones
-- in use: a workout session is materialised by looking up the plan day matching a
-- date's weekday, so a missing day would make that date unreachable.
create or replace function fitness.ensure_plan()
returns uuid
language plpgsql
as $$
declare
    v_plan_id uuid;
begin
    select id into v_plan_id from fitness.plan where user_id = auth.uid() limit 1;

    if v_plan_id is null then
        insert into fitness.plan (user_id, name)
        values (auth.uid(), 'My week')
        returning id into v_plan_id;
    end if;

    -- Idempotent: fills gaps if a day was ever deleted by hand.
    insert into fitness.plan_day (plan_id, day_of_week, focus, rest_day)
    select v_plan_id, d, 'Rest', true
      from generate_series(1, 7) d
     where not exists (
           select 1 from fitness.plan_day
            where plan_id = v_plan_id and day_of_week = d
     );

    return v_plan_id;
end;
$$;


-- ---------------------------------------------------------------- workouts

-- Replaces WorkoutService.getOrMaterialise. The first read of a date is a write.
--
-- Targets are COPIED from plan_exercise, never referenced: editing the plan later
-- must not rewrite a session you already logged. That is also why a session opened
-- before the plan was filled in stays empty -- reload_session_from_plan() below is
-- the repair for exactly that.
create or replace function fitness.ensure_session(p_date date)
returns uuid
language plpgsql
as $$
declare
    v_session_id uuid;
    v_plan_id    uuid;
    v_day        fitness.plan_day;
    v_dow        smallint := extract(isodow from p_date);
begin
    select id into v_session_id
      from fitness.workout_session
     where user_id = auth.uid() and session_date = p_date;

    if v_session_id is not null then
        return v_session_id;
    end if;

    v_plan_id := fitness.ensure_plan();
    select * into v_day
      from fitness.plan_day
     where plan_id = v_plan_id and day_of_week = v_dow;

    insert into fitness.workout_session
        (user_id, session_date, day_of_week, focus, rest_day, notes, status)
    values
        (auth.uid(), p_date, v_dow, v_day.focus, v_day.rest_day, v_day.notes, 'PLANNED')
    -- Arbitrates two concurrent first-reads: the loser takes the winner's row.
    on conflict (user_id, session_date) do nothing
    returning id into v_session_id;

    if v_session_id is null then
        select id into v_session_id
          from fitness.workout_session
         where user_id = auth.uid() and session_date = p_date;
        return v_session_id;
    end if;

    insert into fitness.session_exercise
        (session_id, plan_exercise_id, name, target_sets, target_reps,
         target_weight_kg, order_index)
    select v_session_id, x.id, x.name, x.target_sets, x.target_reps,
           x.target_weight_kg, x.order_index
      from fitness.plan_exercise x
     where x.plan_day_id = v_day.id
     order by x.order_index;

    return v_session_id;
end;
$$;


-- Re-copies the plan day over an existing session. The repair for a date opened
-- before its plan day was filled in.
--
-- Refuses once anything has been ticked: replacing the exercise list would throw
-- away logged weights and reps, and no button should be able to do that silently.
create or replace function fitness.reload_session_from_plan(p_session_id uuid)
returns uuid
language plpgsql
as $$
declare
    v_session fitness.workout_session;
    v_plan_id uuid;
    v_day     fitness.plan_day;
begin
    select * into v_session
      from fitness.workout_session
     where id = p_session_id and user_id = auth.uid();

    if v_session is null then
        raise exception 'Workout not found';
    end if;

    if exists (select 1 from fitness.session_exercise
                where session_id = p_session_id and completed) then
        raise exception 'This workout already has completed exercises. Clear them first, '
                        'or add exercises individually.';
    end if;

    v_plan_id := fitness.ensure_plan();
    select * into v_day
      from fitness.plan_day
     where plan_id = v_plan_id and day_of_week = v_session.day_of_week;

    update fitness.workout_session
       set focus    = v_day.focus,
           rest_day = v_day.rest_day,
           notes    = v_day.notes
     where id = p_session_id;

    delete from fitness.session_exercise where session_id = p_session_id;

    insert into fitness.session_exercise
        (session_id, plan_exercise_id, name, target_sets, target_reps,
         target_weight_kg, order_index)
    select p_session_id, x.id, x.name, x.target_sets, x.target_reps,
           x.target_weight_kg, x.order_index
      from fitness.plan_exercise x
     where x.plan_day_id = v_day.id
     order by x.order_index;

    return p_session_id;
end;
$$;


-- ---------------------------------------------------------------- constraints
--
-- Bean Validation lived in the Java DTOs. With the browser talking to PostgREST
-- directly those annotations are gone, so the rules that actually mattered move
-- into the database, where they cannot be bypassed by any client.

-- Wrapped so the whole file stays re-runnable: every function above is CREATE OR
-- REPLACE, but ADD CONSTRAINT is not idempotent and a second run would abort the
-- script partway through.
do $$
begin
    alter table fitness.daily_goal
        add constraint daily_goal_sane check (
            daily_calorie_goal between 1 and 15000
            and protein_goal   between 1 and 2000
            and carbs_goal     between 1 and 2000
            and fat_goal       between 1 and 2000
        );
exception when duplicate_object then
    raise notice 'daily_goal_sane already present';
end $$;

do $$
begin
    alter table fitness.food_entry
        add constraint food_entry_sane check (
            quantity      > 0
            and calories  >= 0
            and protein_g >= 0
            and carbs_g   >= 0
            and fat_g     >= 0
        );
exception when duplicate_object then
    raise notice 'food_entry_sane already present';
end $$;

do $$
begin
    alter table fitness.plan_exercise
        add constraint plan_exercise_sane
        check (target_sets > 0 and length(btrim(target_reps)) > 0);
exception when duplicate_object then
    raise notice 'plan_exercise_sane already present';
end $$;

do $$
begin
    alter table fitness.session_exercise
        add constraint session_exercise_sane
        check (target_sets > 0 and length(btrim(target_reps)) > 0);
exception when duplicate_object then
    raise notice 'session_exercise_sane already present';
end $$;


grant execute on all functions in schema fitness to authenticated;
alter default privileges in schema fitness grant execute on functions to authenticated;
