-- Clears the data for ONE account, leaving every other user's rows alone.
-- The gentler alternative to 99_clear_data.sql, and what you want on a database
-- that has more than just your own test data in it.
--
-- Set the email below first. auth.uid() is null in the SQL editor -- it reads a
-- request JWT that is not there -- so the account has to be named explicitly.
-- If you would rather paste the UID (Dashboard -> Authentication -> Users),
-- replace the lookup with:  target_user := '<uuid>'::uuid;
--
-- plan_day, plan_exercise and session_exercise carry no user_id; they are
-- reached through their parent and go with it via `on delete cascade`.

do $$
declare
    target_email constant text := 'you@example.com';  -- <-- EDIT ME
    target_user  uuid;
begin
    select id into target_user from auth.users where lower(email) = lower(target_email);

    if target_user is null then
        raise exception 'No account with email %. Check Authentication -> Users.', target_email;
    end if;

    delete from fitness.session_exercise
     where session_id in (select id from fitness.workout_session where user_id = target_user);
    delete from fitness.workout_session where user_id = target_user;

    delete from fitness.plan_exercise
     where plan_day_id in (
        select d.id from fitness.plan_day d
          join fitness.plan p on p.id = d.plan_id
         where p.user_id = target_user);
    delete from fitness.plan_day
     where plan_id in (select id from fitness.plan where user_id = target_user);
    delete from fitness.plan where user_id = target_user;

    delete from fitness.food_entry   where user_id = target_user;
    delete from fitness.food         where user_id = target_user;
    delete from fitness.daily_goal   where user_id = target_user;
    delete from fitness.user_profile where user_id = target_user;

    raise notice 'Cleared every fitness row for % (%).', target_email, target_user;
end;
$$;
