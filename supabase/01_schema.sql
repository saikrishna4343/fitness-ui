-- fitness-api schema. The only script you need to run to get started.
--
-- Everything lives in a dedicated `fitness` schema rather than `public`, so it
-- sits alongside Supabase's own `auth` and `storage` schemas without colliding.
-- Every object below is explicitly qualified -- do not rely on search_path,
-- which resets between SQL editor sessions.
--
-- Plain Postgres, no migration tool. Re-running it fails on the existing tables;
-- README.md has a reset snippet if you need to start over.
--
-- Creates empty tables only. There is no seed data: GET /api/profile and
-- GET /api/plan both create their rows on first call, and everything else is
-- entered through the UI.
--
-- Row level security is deliberately NOT enabled here -- see
-- 02_row_level_security.sql, which must not be run until auth is on.

create schema if not exists fitness;

-- pgcrypto lives in `extensions` on Supabase and is already installed; this is
-- a no-op there, and does the right thing on a plain Postgres.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profile

create table fitness.user_profile (
    user_id            uuid primary key,
    first_name         text,
    last_name          text,
    sex                text check (sex in ('MALE', 'FEMALE', 'OTHER')),
    height_cm          integer,
    weight_kg          numeric(6, 2),
    activity_level     text    not null default 'MODERATELY_ACTIVE'
                       check (activity_level in ('SEDENTARY', 'LIGHTLY_ACTIVE',
                              'MODERATELY_ACTIVE', 'VERY_ACTIVE', 'EXTRA_ACTIVE')),
    goal               text    not null default 'MAINTAIN'
                       check (goal in ('LOSE_WEIGHT', 'MAINTAIN', 'GAIN_MUSCLE')),
    daily_calorie_goal integer not null default 2000,
    protein_goal       integer not null default 150,
    carbs_goal         integer not null default 200,
    fat_goal           integer not null default 65,
    timezone           text    not null default 'UTC',
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------- goals

-- A goal the user set for one specific date. Rows exist ONLY for days someone
-- deliberately set; days in between are answered by carrying the most recent
-- earlier row forward at read time, so there is nothing to backfill and no
-- nightly job.
--
-- The composite primary key is also the index for the resolution query
--     where user_id = ? and goal_date <= ? order by goal_date desc limit 1
-- which returns the exact row when one exists and the nearest earlier row when
-- it does not. Leading column equality, second column ranged -- no extra index.
--
-- The user_profile goal columns above remain the fallback, used until a date has
-- a goal on or before it. That is what makes this table safe to add with no
-- migration: while it is empty every day resolves exactly as it did before.
create table fitness.daily_goal (
    user_id            uuid    not null,
    goal_date          date    not null,
    daily_calorie_goal integer not null,
    protein_goal       integer not null,
    carbs_goal         integer not null,
    fat_goal           integer not null,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    primary key (user_id, goal_date)
);

-- ---------------------------------------------------------------- food

create table fitness.food (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid          not null,
    name         text          not null,
    brand        text,
    serving_size numeric(8, 2) not null,
    serving_unit text          not null,
    calories     integer       not null,
    protein_g    numeric(7, 1) not null,
    carbs_g      numeric(7, 1) not null,
    fat_g        numeric(7, 1) not null
);

-- Backs GET /api/foods?q= -- case-insensitive contains on name or brand.
create index food_user_name_idx  on fitness.food (user_id, lower(name));
create index food_user_brand_idx on fitness.food (user_id, lower(brand));

-- food_entry COPIES a food's macros rather than referencing them: a logged entry
-- is a historical fact, and correcting a food must never rewrite past totals.
-- food_id is provenance only, which is why it nulls out rather than cascading.
create table fitness.food_entry (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null,
    food_id    uuid references fitness.food (id) on delete set null,
    entry_date date        not null,
    eaten_at   timestamptz not null,
    meal       text not null
               check (meal in ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK')),
    name       text          not null,
    quantity   numeric(8, 2) not null,
    unit       text          not null,
    calories   integer       not null,
    protein_g  numeric(7, 1) not null,
    carbs_g    numeric(7, 1) not null,
    fat_g      numeric(7, 1) not null,
    notes      text
);

-- Serves both the single-day lookup and the 90-day range scan.
create index food_entry_user_date_idx on fitness.food_entry (user_id, entry_date);

-- ---------------------------------------------------------------- plan

create table fitness.plan (
    id      uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    name    text not null
);

create index plan_user_idx on fitness.plan (user_id);

create table fitness.plan_day (
    id          uuid primary key default gen_random_uuid(),
    plan_id     uuid     not null references fitness.plan (id) on delete cascade,
    day_of_week smallint not null check (day_of_week between 1 and 7),
    focus       text     not null,
    rest_day    boolean  not null default false,
    notes       text,
    unique (plan_id, day_of_week)
);

create table fitness.plan_exercise (
    id               uuid    primary key default gen_random_uuid(),
    plan_day_id      uuid    not null references fitness.plan_day (id) on delete cascade,
    name             text    not null,
    target_sets      integer not null,
    target_reps      text    not null,  -- "6-8", "10 each", "60s" -- a string, not a number
    target_weight_kg numeric(6, 2),     -- null for bodyweight work
    order_index      integer not null,  -- 0-based, contiguous, recompacted on delete
    notes            text
);

create index plan_exercise_day_idx on fitness.plan_exercise (plan_day_id, order_index);

-- ---------------------------------------------------------------- workouts

-- Materialised from plan_day on the first GET /api/workouts?date= for a date.
-- The unique constraint is what arbitrates two concurrent first-GETs.
create table fitness.workout_session (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid     not null,
    session_date date     not null,
    day_of_week  smallint not null check (day_of_week between 1 and 7),
    focus        text     not null,
    rest_day     boolean  not null default false,
    status       text     not null default 'PLANNED'
                 check (status in ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED')),
    completed_at timestamptz,
    notes        text,
    unique (user_id, session_date)
);

-- Like food_entry, this copies its targets from plan_exercise. No FK on
-- plan_exercise_id: the template may be edited or deleted afterwards, and the
-- logged session must survive that untouched.
create table fitness.session_exercise (
    id               uuid    primary key default gen_random_uuid(),
    session_id       uuid    not null references fitness.workout_session (id) on delete cascade,
    plan_exercise_id uuid,
    name             text    not null,
    target_sets      integer not null,
    target_reps      text    not null,
    target_weight_kg numeric(6, 2),
    actual_weight_kg numeric(6, 2),
    actual_reps      text,
    completed        boolean not null default false,
    completed_at     timestamptz,
    order_index      integer not null,
    notes            text
);

create index session_exercise_session_idx on fitness.session_exercise (session_id, order_index);

-- ---------------------------------------------------------------- grants
--
-- Only needed if the API connects as a role other than the schema owner.
-- Harmless to run either way.

grant usage on schema fitness to postgres, anon, authenticated, service_role;
grant all on all tables    in schema fitness to postgres, service_role;
grant all on all sequences in schema fitness to postgres, service_role;
