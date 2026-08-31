-- The write-side logic from WorkoutService and PlanService.
--
-- 03_api.sql covered the four read/materialise paths. These are the remaining pieces
-- that were doing real work in Java: status transitions, completed_at stamping, and
-- order_index maintenance. Everything else is a plain insert/update/delete the client
-- issues directly against the tables.
--
-- Each one is SECURITY INVOKER and reaches rows only through a join back to a table
-- keyed by user_id, so RLS applies exactly as it does to a direct query. Passing
-- someone else's id finds nothing rather than touching it.
--
-- Run after 03_api.sql. Safe to re-run.

-- ---------------------------------------------------------------- session exercises

-- Replaces WorkoutService.tick. Partial update: null means "leave alone".
--
-- Setting completed also stamps or clears completed_at, and lifts a PLANNED session
-- to IN_PROGRESS -- three writes the UI would otherwise have to keep in step itself.
create or replace function fitness.tick_session_exercise(
    p_id             uuid,
    p_completed      boolean default null,
    p_actual_weight  numeric default null,
    p_actual_reps    text    default null,
    p_notes          text    default null
)
returns fitness.session_exercise
language plpgsql
as $$
declare
    result     fitness.session_exercise;
    v_session  uuid;
begin
    select session_id into v_session
      from fitness.session_exercise x
      join fitness.workout_session s on s.id = x.session_id
     where x.id = p_id and s.user_id = auth.uid();

    if v_session is null then
        raise exception 'Exercise not found';
    end if;

    update fitness.session_exercise
       set completed        = coalesce(p_completed, completed),
           completed_at     = case
                                  when p_completed is null then completed_at
                                  when p_completed         then now()
                                  else null
                              end,
           actual_weight_kg = coalesce(p_actual_weight, actual_weight_kg),
           actual_reps      = coalesce(p_actual_reps, actual_reps),
           notes            = coalesce(p_notes, notes)
     where id = p_id
    returning * into result;

    update fitness.workout_session
       set status = 'IN_PROGRESS'
     where id = v_session
       and status = 'PLANNED'
       and exists (select 1 from fitness.session_exercise
                    where session_id = v_session and completed);

    return result;
end;
$$;


-- Appends to a session. order_index is computed here rather than sent by the client:
-- two tabs adding at once would otherwise both claim the same position.
create or replace function fitness.add_session_exercise(
    p_session_id uuid,
    p_name       text,
    p_sets       integer,
    p_reps       text,
    p_weight     numeric default null,
    p_notes      text    default null
)
returns fitness.session_exercise
language plpgsql
as $$
declare
    result fitness.session_exercise;
begin
    if not exists (select 1 from fitness.workout_session
                    where id = p_session_id and user_id = auth.uid()) then
        raise exception 'Workout not found';
    end if;

    insert into fitness.session_exercise
        (session_id, name, target_sets, target_reps, target_weight_kg, notes, order_index)
    select p_session_id, p_name, p_sets, p_reps, p_weight, p_notes,
           coalesce(max(order_index) + 1, 0)
      from fitness.session_exercise where session_id = p_session_id
    returning * into result;

    return result;
end;
$$;


-- Delete, then close the gap so order_index stays 0..n-1 with no holes.
create or replace function fitness.delete_session_exercise(p_id uuid)
returns void
language plpgsql
as $$
declare
    v_session uuid;
begin
    select x.session_id into v_session
      from fitness.session_exercise x
      join fitness.workout_session s on s.id = x.session_id
     where x.id = p_id and s.user_id = auth.uid();

    if v_session is null then
        raise exception 'Exercise not found';
    end if;

    delete from fitness.session_exercise where id = p_id;

    with renumbered as (
        select id, row_number() over (order by order_index) - 1 as position
          from fitness.session_exercise where session_id = v_session
    )
    update fitness.session_exercise x
       set order_index = r.position
      from renumbered r
     where x.id = r.id and x.order_index is distinct from r.position;
end;
$$;


-- ---------------------------------------------------------------- sessions

-- Replaces WorkoutService.complete: the "I did what was planned" button. Fills any
-- missing actuals from the targets, then closes the session.
create or replace function fitness.complete_workout(p_session_id uuid)
returns uuid
language plpgsql
as $$
begin
    if not exists (select 1 from fitness.workout_session
                    where id = p_session_id and user_id = auth.uid()) then
        raise exception 'Workout not found';
    end if;

    update fitness.session_exercise
       set completed        = true,
           completed_at     = coalesce(completed_at, now()),
           actual_weight_kg = coalesce(actual_weight_kg, target_weight_kg),
           actual_reps      = coalesce(actual_reps, target_reps)
     where session_id = p_session_id and not completed;

    update fitness.workout_session
       set status = 'COMPLETED', completed_at = now()
     where id = p_session_id;

    return p_session_id;
end;
$$;


-- Exercises are left exactly as they were.
create or replace function fitness.skip_workout(p_session_id uuid)
returns uuid
language plpgsql
as $$
begin
    update fitness.workout_session
       set status = 'SKIPPED', completed_at = null
     where id = p_session_id and user_id = auth.uid();

    if not found then
        raise exception 'Workout not found';
    end if;
    return p_session_id;
end;
$$;


-- ---------------------------------------------------------------- plan exercises

create or replace function fitness.add_plan_exercise(
    p_day_of_week integer,
    p_name        text,
    p_sets        integer,
    p_reps        text,
    p_weight      numeric default null,
    p_notes       text    default null
)
returns fitness.plan_exercise
language plpgsql
as $$
declare
    v_day_id uuid;
    result   fitness.plan_exercise;
begin
    select d.id into v_day_id
      from fitness.plan_day d
      join fitness.plan p on p.id = d.plan_id
     where p.user_id = auth.uid() and d.day_of_week = p_day_of_week;

    if v_day_id is null then
        raise exception 'No plan day for day %', p_day_of_week;
    end if;

    insert into fitness.plan_exercise
        (plan_day_id, name, target_sets, target_reps, target_weight_kg, notes, order_index)
    select v_day_id, p_name, p_sets, p_reps, p_weight, p_notes,
           coalesce(max(order_index) + 1, 0)
      from fitness.plan_exercise where plan_day_id = v_day_id
    returning * into result;

    return result;
end;
$$;


create or replace function fitness.delete_plan_exercise(p_id uuid)
returns void
language plpgsql
as $$
declare
    v_day_id uuid;
begin
    select x.plan_day_id into v_day_id
      from fitness.plan_exercise x
      join fitness.plan_day d on d.id = x.plan_day_id
      join fitness.plan p on p.id = d.plan_id
     where x.id = p_id and p.user_id = auth.uid();

    if v_day_id is null then
        raise exception 'Exercise not found';
    end if;

    delete from fitness.plan_exercise where id = p_id;

    with renumbered as (
        select id, row_number() over (order by order_index) - 1 as position
          from fitness.plan_exercise where plan_day_id = v_day_id
    )
    update fitness.plan_exercise x
       set order_index = r.position
      from renumbered r
     where x.id = r.id and x.order_index is distinct from r.position;
end;
$$;


-- Reassigns order_index by array position. Ids not on this day are ignored, and
-- anything the client omitted keeps its place at the end.
create or replace function fitness.reorder_plan_exercises(
    p_day_of_week integer,
    p_ids         uuid[]
)
returns void
language plpgsql
as $$
declare
    v_day_id uuid;
begin
    select d.id into v_day_id
      from fitness.plan_day d
      join fitness.plan p on p.id = d.plan_id
     where p.user_id = auth.uid() and d.day_of_week = p_day_of_week;

    if v_day_id is null then
        raise exception 'No plan day for day %', p_day_of_week;
    end if;

    with ranked as (
        select x.id,
               row_number() over (
                   order by coalesce(array_position(p_ids, x.id), 1000000), x.order_index
               ) - 1 as position
          from fitness.plan_exercise x
         where x.plan_day_id = v_day_id
    )
    update fitness.plan_exercise x
       set order_index = r.position
      from ranked r
     where x.id = r.id and x.order_index is distinct from r.position;
end;
$$;


grant execute on all functions in schema fitness to authenticated;
