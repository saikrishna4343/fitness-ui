-- The coach: everything it reads, everything it remembers, and its spend cap.
--
-- Run AFTER 12_birth_date.sql (coach_targets needs the age) and BEFORE
-- 02_row_level_security.sql if you are building a database from scratch. On a
-- live database, run this file and then re-run 02_row_level_security.sql --
-- the policies at the bottom here are the only ones for these two tables, so
-- they are included rather than left for that file.
--
-- The design rule, same as everywhere else in this schema: nothing filters by
-- user id. RLS does that on every query, including the ones nobody remembered
-- to check. The model reaches this data only through a Postgres connection
-- carrying the caller's own JWT, so an over-curious tool call returns an empty
-- result rather than someone else's food log.

-- ---------------------------------------------------------------- history

-- The rest-day walk-back, in one query.
--
-- "When did I last train" cannot be answered by looking at yesterday: yesterday
-- is often a rest day, and the day before that might be too. Walking back day by
-- day from the client would be N round trips and N chances to disagree with the
-- Progress screen. This is one.
--
-- A day counts as training only if something was actually ticked. A session that
-- was created and abandoned is not a leg day.
create or replace function fitness.last_training_day(p_before date default current_date)
returns table (session_date date, focus text, days_ago int, exercises jsonb)
language sql
stable
as $$
    select s.session_date,
           s.focus,
           (p_before - s.session_date)::int,
           jsonb_agg(jsonb_build_object(
               'name',     e.name,
               'sets',     e.target_sets,
               'reps',     coalesce(e.actual_reps, e.target_reps),
               'weightKg', coalesce(e.actual_weight_kg, e.target_weight_kg)
           ) order by e.order_index)
      from fitness.workout_session s
      join fitness.session_exercise e on e.session_id = s.id
     where s.session_date < p_before
       and not s.rest_day
       and e.completed
     group by s.id, s.session_date, s.focus
     order by s.session_date desc
     limit 1;
$$;


-- The last few weeks of training, for progression: what was done, how heavy, and
-- whether it was finished. Rest days are included as empty rows so a gap in the
-- week is visible rather than merely absent.
create or replace function fitness.training_history(p_days int default 21)
returns table (
    session_date date,
    focus        text,
    status       text,
    rest_day     boolean,
    exercises    jsonb
)
language sql
stable
as $$
    select s.session_date,
           s.focus,
           s.status,
           s.rest_day,
           coalesce(
               jsonb_agg(jsonb_build_object(
                   'name',       e.name,
                   'sets',       e.target_sets,
                   'targetReps', e.target_reps,
                   'actualReps', e.actual_reps,
                   'weightKg',   coalesce(e.actual_weight_kg, e.target_weight_kg),
                   'completed',  e.completed
               ) order by e.order_index) filter (where e.id is not null),
               '[]'::jsonb)
      from fitness.workout_session s
      left join fitness.session_exercise e on e.session_id = s.id
     where s.session_date > current_date - greatest(p_days, 1)
       and s.session_date <= current_date
     group by s.id, s.session_date, s.focus, s.status, s.rest_day
     order by s.session_date desc;
$$;


-- ---------------------------------------------------------------- targets

-- What the profile implies you should eat, computed here rather than by the model.
--
-- Mifflin-St Jeor for resting energy, an activity multiplier for the rest, and a
-- goal adjustment on top. Every one of those is arithmetic, and arithmetic is
-- exactly what a language model does confidently and wrongly -- so it comes back
-- as a number the model explains rather than a sum it performs.
--
-- When the profile is missing a field the answer is null and `missing` says which,
-- so the coach can ask for it instead of quoting a target built on an assumption.
create or replace function fitness.coach_targets()
returns table (
    age                int,
    sex                text,
    height_cm          int,
    weight_kg          numeric,
    activity_level     text,
    goal               text,
    bmr                int,
    maintenance        int,
    suggested_calories int,
    stored_goal        int,
    missing            text[]
)
language plpgsql
stable
as $$
declare
    p          fitness.user_profile;
    v_age      int;
    v_bmr      numeric;
    v_factor   numeric;
    v_missing  text[] := '{}';
begin
    select * into p from fitness.user_profile limit 1;   -- RLS: only ever your row
    if not found then
        return;
    end if;

    v_age := case when p.birth_date is null then null
                  else extract(year from age(p.birth_date))::int end;

    if v_age is null       then v_missing := v_missing || 'birthDate'; end if;
    if p.height_cm is null then v_missing := v_missing || 'heightCm';  end if;
    if p.weight_kg is null then v_missing := v_missing || 'weightKg';  end if;
    if p.sex is null       then v_missing := v_missing || 'sex';       end if;

    if v_age is not null and p.height_cm is not null and p.weight_kg is not null then
        -- Mifflin-St Jeor. With sex unknown, the midpoint of the two constants --
        -- the honest average rather than a coin flip, and `missing` says so.
        v_bmr := 10 * p.weight_kg + 6.25 * p.height_cm - 5 * v_age
               + case upper(coalesce(p.sex, ''))
                     when 'MALE'   then  5
                     when 'FEMALE' then -161
                     else -78
                 end;

        v_factor := case p.activity_level
                        when 'SEDENTARY'         then 1.2
                        when 'LIGHTLY_ACTIVE'    then 1.375
                        when 'MODERATELY_ACTIVE' then 1.55
                        when 'VERY_ACTIVE'       then 1.725
                        when 'EXTRA_ACTIVE'      then 1.9
                        else 1.55
                    end;
    end if;

    return query
    select v_age,
           p.sex,
           p.height_cm,
           p.weight_kg,
           p.activity_level,
           p.goal,
           round(v_bmr)::int,
           round(v_bmr * v_factor)::int,
           case
               when v_bmr is null then null
               -- The floor is not advice, it is a guard: no goal justifies the
               -- coach proposing a starvation target, so the deficit stops here.
               when p.goal = 'LOSE_WEIGHT' then greatest(1200, round(v_bmr * v_factor - 500)::int)
               when p.goal = 'GAIN_MUSCLE' then round(v_bmr * v_factor + 300)::int
               else round(v_bmr * v_factor)::int
           end,
           p.daily_calorie_goal,
           v_missing;
end;
$$;


-- ---------------------------------------------------------------- conversation

-- One row per message, content as jsonb so tool calls and their results survive
-- the round trip intact -- replaying a conversation to the model needs the
-- blocks, not a flattened string.
--
-- `status` is declared here rather than left to 08_audit_columns.sql so this
-- table works whichever order the two files are run in; that file's
-- `add column if not exists` leaves it alone. Clearing the conversation flips it
-- to 'I' instead of deleting: the history is yours, and an accidental clear
-- should be recoverable from the SQL editor.
create table if not exists fitness.coach_message (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null default auth.uid(),
    role       text not null check (role in ('user', 'assistant')),
    content    jsonb not null,
    status     char(1) not null default 'A',
    created_at timestamptz not null default now()
);

create index if not exists coach_message_user_created_idx
    on fitness.coach_message (user_id, created_at desc)
    where status = 'A';


-- ---------------------------------------------------------------- spend cap

-- A per-day message count, checked before the API call.
--
-- Not optional, and not something to add after the first surprising invoice: an
-- unbounded loop between a chat box and a paid API is the one failure here that
-- costs real money rather than merely looking wrong.
create table if not exists fitness.coach_usage (
    user_id       uuid   not null default auth.uid(),
    usage_date    date   not null default current_date,
    messages      int    not null default 0,
    input_tokens  bigint not null default 0,
    output_tokens bigint not null default 0,
    primary key (user_id, usage_date)
);

-- Claims a turn and reports whether it was within the cap, in one statement --
-- two tabs asking at once cannot both read "39 used" and both proceed.
create or replace function fitness.coach_take_turn(p_limit int default 40)
returns table (allowed boolean, used int, day_limit int)
language plpgsql
as $$
declare
    v_used int;
begin
    insert into fitness.coach_usage (user_id, usage_date, messages)
    values (auth.uid(), current_date, 1)
    on conflict (user_id, usage_date)
        do update set messages = coach_usage.messages + 1
    returning messages into v_used;

    return query select v_used <= p_limit, v_used, p_limit;
end;
$$;

create or replace function fitness.coach_record_usage(p_input bigint, p_output bigint)
returns void
language sql
as $$
    update fitness.coach_usage
       set input_tokens  = input_tokens + greatest(p_input, 0),
           output_tokens = output_tokens + greatest(p_output, 0)
     where usage_date = current_date;
$$;


-- ---------------------------------------------------------------- grants + policies

grant usage on schema fitness to authenticated;
grant select, insert, update on fitness.coach_message to authenticated;
grant select, insert, update on fitness.coach_usage   to authenticated;
grant execute on function fitness.last_training_day(date)   to authenticated;
grant execute on function fitness.training_history(int)     to authenticated;
grant execute on function fitness.coach_targets()           to authenticated;
grant execute on function fitness.coach_take_turn(int)      to authenticated;
grant execute on function fitness.coach_record_usage(bigint, bigint) to authenticated;

alter table fitness.coach_message enable row level security;
alter table fitness.coach_usage   enable row level security;

drop policy if exists coach_message_own on fitness.coach_message;
create policy coach_message_own on fitness.coach_message
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop policy if exists coach_usage_own on fitness.coach_usage;
create policy coach_usage_own on fitness.coach_usage
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());
