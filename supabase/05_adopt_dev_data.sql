-- Moves the data created under the hardcoded dev user onto your real account.
--
-- Run this ONCE, after you have signed up through the app for the first time and
-- BEFORE 02_row_level_security.sql. Skip it and RLS will hide everything you have
-- entered so far -- the plan, the food entries, the goals -- because every row is
-- still owned by a user id that no longer means anything.
--
-- The dev user is the constant that CurrentUserIdArgumentResolver returned for
-- every request while Spring Boot was in front of the database.

do $$
declare
    dev_user  constant uuid := '00000000-0000-0000-0000-000000000001';
    real_user uuid;
    moved     integer;
begin
    -- Whichever account you signed up with. If you have created more than one,
    -- replace this with the id you actually want, from Dashboard -> Authentication.
    select id into real_user
      from auth.users
     order by created_at
     limit 1;

    if real_user is null then
        raise exception 'No user in auth.users yet -- sign up through the app first.';
    end if;

    if real_user = dev_user then
        raise notice 'Nothing to do: the dev user IS your account id.';
        return;
    end if;

    -- Child tables (plan_day, plan_exercise, session_exercise) carry no user_id;
    -- they follow their parent automatically.
    --
    -- Clear the empties first. Simply signing in creates a profile, and opening any
    -- page creates a plan and a session for that date -- all of them blank. Left in
    -- place they collide with the rows being adopted: user_profile is keyed by
    -- user_id alone, daily_goal by (user_id, goal_date), workout_session has a
    -- unique (user_id, session_date). Only rows belonging to the NEW account are
    -- touched here, and only the auto-created ones, so nothing you entered is at
    -- risk -- everything you entered is still owned by the dev user at this point.

    delete from fitness.daily_goal      where user_id = real_user;
    get diagnostics moved = row_count;  raise notice 'cleared % blank daily_goal row(s)',      moved;

    delete from fitness.workout_session where user_id = real_user;
    get diagnostics moved = row_count;  raise notice 'cleared % blank workout_session row(s)', moved;

    delete from fitness.plan           where user_id = real_user;
    get diagnostics moved = row_count;  raise notice 'cleared % blank plan row(s)',            moved;

    delete from fitness.user_profile   where user_id = real_user;
    get diagnostics moved = row_count;  raise notice 'cleared % blank user_profile row(s)',    moved;

    -- Now the move.

    update fitness.user_profile    set user_id = real_user where user_id = dev_user;
    get diagnostics moved = row_count;  raise notice 'user_profile:    % row(s)',    moved;

    update fitness.daily_goal      set user_id = real_user where user_id = dev_user;
    get diagnostics moved = row_count;  raise notice 'daily_goal:      % row(s)',    moved;

    update fitness.food            set user_id = real_user where user_id = dev_user;
    get diagnostics moved = row_count;  raise notice 'food:            % row(s)',    moved;

    update fitness.food_entry      set user_id = real_user where user_id = dev_user;
    get diagnostics moved = row_count;  raise notice 'food_entry:      % row(s)',    moved;

    update fitness.plan            set user_id = real_user where user_id = dev_user;
    get diagnostics moved = row_count;  raise notice 'plan:            % row(s)',    moved;

    update fitness.workout_session set user_id = real_user where user_id = dev_user;
    get diagnostics moved = row_count;  raise notice 'workout_session: % row(s)',    moved;

    raise notice 'Adopted onto %', real_user;
end;
$$;


-- Sanity check: this must return zero rows before you apply RLS.
select 'user_profile'    as table_name, count(*) from fitness.user_profile    where user_id = '00000000-0000-0000-0000-000000000001'
union all select 'daily_goal',      count(*) from fitness.daily_goal      where user_id = '00000000-0000-0000-0000-000000000001'
union all select 'food',            count(*) from fitness.food            where user_id = '00000000-0000-0000-0000-000000000001'
union all select 'food_entry',      count(*) from fitness.food_entry      where user_id = '00000000-0000-0000-0000-000000000001'
union all select 'plan',            count(*) from fitness.plan            where user_id = '00000000-0000-0000-0000-000000000001'
union all select 'workout_session', count(*) from fitness.workout_session where user_id = '00000000-0000-0000-0000-000000000001';
