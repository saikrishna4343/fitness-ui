-- Adds calories burned to workouts and a burn goal to the profile, on a database
-- created before they existed.
--
-- A fresh install gets all three columns from 01_schema.sql and must skip this file.
--
-- Run it once, then RE-RUN 03_api.sql, for two reasons:
--   * fitness.daily_summary() gains the burn columns, and reads min_burn_goal.
--   * fitness.ensure_profile() returns `fitness.user_profile` -- the table's own
--     row type -- so it has to be recreated before min_burn_goal reaches the API.
--
-- Re-runnable: `add column if not exists` skips its check along with the column.

alter table fitness.workout_session
    add column if not exists calories_burned integer
        check (calories_burned between 0 and 10000);

alter table fitness.workout_session
    add column if not exists duration_minutes integer
        check (duration_minutes between 1 and 1440);

alter table fitness.user_profile
    add column if not exists min_burn_goal integer not null default 600
        check (min_burn_goal between 0 and 10000);

comment on column fitness.workout_session.calories_burned is
    'Optional. Typed by the user, and overrides the estimate in daily_summary().';
comment on column fitness.workout_session.duration_minutes is
    'Optional. When set, daily_summary() estimates the burn from it instead of from completed sets.';
comment on column fitness.user_profile.min_burn_goal is
    'Floor under a training day''s burn target, which is otherwise calories eaten above the goal.';
