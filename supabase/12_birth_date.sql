-- Adds `birth_date` to the profile, on a database created before it existed.
--
-- A fresh install gets the column from 01_schema.sql and must skip this file.
--
-- Age is what the profile was missing to be able to compute anything: every
-- maintenance-calorie formula worth using (Mifflin-St Jeor, Harris-Benedict)
-- takes age alongside the sex, height and weight already stored here. Without
-- it a calorie target is a guess dressed as a number.
--
-- Run it once, then RE-RUN 03_api.sql. fitness.ensure_profile() returns
-- `fitness.user_profile` -- the table's own row type -- so it has to be
-- recreated for the new column to appear in what PostgREST serves.

alter table fitness.user_profile
    add column if not exists birth_date date;

-- Only the lower bound is a constraint. "Not in the future" cannot be one:
-- CHECK forbids non-immutable functions, so current_date is not available
-- here, and a constraint that was true when written would go on being true
-- forever afterwards anyway. The date input caps that end instead.
do $$
begin
    if not exists (
        select 1 from pg_constraint
         where conname = 'user_profile_birth_date_check'
           and conrelid = 'fitness.user_profile'::regclass
    ) then
        alter table fitness.user_profile
            add constraint user_profile_birth_date_check
            check (birth_date is null or birth_date > date '1900-01-01');
    end if;
end
$$;

comment on column fitness.user_profile.birth_date is
    'Optional. Age is derived from this at read time -- never stored, so it cannot go stale.';
