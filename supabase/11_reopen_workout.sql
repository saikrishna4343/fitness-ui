-- Fixes a workout that cannot come back from COMPLETED.
--
-- Two separate holes:
--
--   1. tick_session_exercise only ever lifted PLANNED -> IN_PROGRESS. Unticking an
--      exercise on a COMPLETED session left the status alone, so the header read
--      "Completed" next to a count of 4/5. The status is now DERIVED from the ticks
--      on every tick, in both directions.
--
--   2. Nothing could move a session out of COMPLETED at all, so an accidental
--      "Mark workout complete" was permanent. reopen_workout() below is the undo.
--
-- Run after 06_api_writes.sql -- it replaces one function from it. Safe to re-run.

-- ---------------------------------------------------------------- tick

-- Same signature and same partial-update rule as before: null means "leave alone".
-- The only change is the status block at the end.
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
    result    fitness.session_exercise;
    v_session uuid;
    v_done    integer;
    v_total   integer;
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

    -- Only a tick moves the status. Recording a weight or a rep count is not a
    -- statement about whether the session is finished.
    if p_completed is not null then
        select count(*) filter (where completed), count(*)
          into v_done, v_total
          from fitness.session_exercise where session_id = v_session;

        update fitness.workout_session s
           set status = case
                            -- Nothing ticked: back to untouched.
                            when v_done = 0            then 'PLANNED'
                            -- Part way: in progress, whatever it was before --
                            -- this is the branch that releases a COMPLETED session.
                            when v_done < v_total      then 'IN_PROGRESS'
                            -- All ticked. Completing stays completed; otherwise the
                            -- explicit button is still what closes a session, so
                            -- ticking the last box does not close it for you.
                            when s.status = 'COMPLETED' then 'COMPLETED'
                            else 'IN_PROGRESS'
                        end,
               completed_at = case
                                  when v_done = v_total and s.status = 'COMPLETED'
                                  then s.completed_at
                                  else null
                              end
         where s.id = v_session;
    end if;

    return result;
end;
$$;

-- ---------------------------------------------------------------- reopen

-- The undo for "Mark workout complete" and for "Skip today".
--
-- It reopens the SESSION only; the exercise ticks are left exactly as they are.
-- complete_workout() ticked everything and filled the missing actuals from the
-- targets, and there is no record of what was set before it ran -- so unticking
-- here would be inventing a previous state rather than restoring one. The status
-- lands on IN_PROGRESS with the boxes still ticked, and unticking them is now a
-- working way back to PLANNED.
create or replace function fitness.reopen_workout(p_session_id uuid)
returns uuid
language plpgsql
as $$
declare
    v_done integer;
begin
    if not exists (select 1 from fitness.workout_session
                    where id = p_session_id and user_id = auth.uid()) then
        raise exception 'Workout not found';
    end if;

    select count(*) filter (where completed) into v_done
      from fitness.session_exercise where session_id = p_session_id;

    update fitness.workout_session
       set status       = case when v_done = 0 then 'PLANNED' else 'IN_PROGRESS' end,
           completed_at = null
     where id = p_session_id;

    return p_session_id;
end;
$$;

grant execute on all functions in schema fitness to authenticated;
