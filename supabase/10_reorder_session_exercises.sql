-- Move an exercise up or down within one day's workout.
--
-- The session twin of fitness.reorder_plan_exercises in 06_api_writes.sql, and
-- deliberately the same shape: the client sends the ids in the order it wants,
-- the function assigns order_index by array position. Sending positions instead
-- would let two tabs disagree about what "2" means; an id list cannot.
--
-- No migration comes with this. session_exercise has carried order_index since
-- 01_schema.sql -- materialised from the plan in order, appended by
-- add_session_exercise, recompacted by delete_session_exercise -- so existing
-- rows are already 0..n-1 with no holes and there is nothing to backfill.
--
-- Run after 06_api_writes.sql. Safe to re-run.

-- Takes the session id rather than a date: the caller already has it from the
-- workout it is rendering, and it saves re-resolving the date to a session.
-- SECURITY INVOKER, and the join to workout_session is what scopes it to the
-- caller -- passing someone else's session id finds nothing.
create or replace function fitness.reorder_session_exercises(
    p_session_id uuid,
    p_ids        uuid[]
)
returns void
language plpgsql
as $$
declare
    v_session uuid;
begin
    select s.id into v_session
      from fitness.workout_session s
     where s.id = p_session_id and s.user_id = auth.uid();

    if v_session is null then
        raise exception 'Workout not found';
    end if;

    -- Ids not in this session are ignored, and anything the client left out
    -- keeps its place at the end -- the 1000000 sort key -- so a stale tab
    -- cannot drop an exercise it never knew about.
    with ranked as (
        select x.id,
               row_number() over (
                   order by coalesce(array_position(p_ids, x.id), 1000000), x.order_index
               ) - 1 as position
          from fitness.session_exercise x
         where x.session_id = v_session
    )
    update fitness.session_exercise x
       set order_index = r.position
      from ranked r
     where x.id = r.id and x.order_index is distinct from r.position;
end;
$$;

grant execute on all functions in schema fitness to authenticated;
