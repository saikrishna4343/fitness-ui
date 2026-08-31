-- Maintenance columns on every table in the `fitness` schema:
--
--   status      char(1) 'A' active / 'I' inactive
--   created_at  timestamptz  when the row was inserted
--   created_by  uuid         who inserted it (auth.uid())
--   updated_at  timestamptz  when it was last written
--   updated_by  uuid         who last wrote it
--
-- Safe to re-run, and safe to run on a database that already has data: every
-- step is guarded, and existing rows get status 'A' and a created_at of now().
--
-- Run it AFTER 01_schema.sql. Re-running it is also how a table added later
-- picks the columns up -- the loop below finds every table in the schema, so
-- there is no list here to keep in sync.
--
-- user_profile and daily_goal already declared created_at/updated_at in
-- 01_schema.sql. `add column if not exists` leaves those alone, so they keep
-- their `not null default now()` and simply gain the other three.

-- ------------------------------------------------- who and when, on every write
--
-- A trigger, not column defaults: a default fires only when the caller omits the
-- column, so any client that passes its own updated_at would win. This way the
-- database is the only writer of these five columns and the values cannot be
-- forged from the browser -- which matters because PostgREST exposes the tables
-- directly and the anon key is public.
--
-- auth.uid() is null outside a request (the SQL editor, a cron job); the row is
-- still written, just with a null actor rather than failing.
create or replace function fitness.touch_audit()
returns trigger
language plpgsql
as $$
begin
    if tg_op = 'INSERT' then
        new.status     := coalesce(new.status, 'A');
        new.created_at := coalesce(new.created_at, now());
        new.created_by := coalesce(new.created_by, auth.uid());
        new.updated_at := new.created_at;
        new.updated_by := new.created_by;
    else
        -- created_* is set once and never again, whatever the update says.
        new.created_at := old.created_at;
        new.created_by := old.created_by;
        new.updated_at := now();
        new.updated_by := coalesce(auth.uid(), old.updated_by);
    end if;
    return new;
end;
$$;

-- ------------------------------------------------- apply to every table

do $$
declare
    t text;
begin
    for t in
        select table_name
          from information_schema.tables
         where table_schema = 'fitness'
           and table_type   = 'BASE TABLE'
         order by table_name
    loop
        execute format($f$
            alter table fitness.%1$I add column if not exists status     char(1);
            alter table fitness.%1$I add column if not exists created_at timestamptz;
            alter table fitness.%1$I add column if not exists created_by uuid;
            alter table fitness.%1$I add column if not exists updated_at timestamptz;
            alter table fitness.%1$I add column if not exists updated_by uuid;

            -- Backfill before the not-null constraints go on. Rows that predate
            -- this script have no real timestamp to recover, so they get now().
            update fitness.%1$I
               set status     = coalesce(status, 'A'),
                   created_at = coalesce(created_at, now()),
                   updated_at = coalesce(updated_at, created_at, now());

            alter table fitness.%1$I alter column status     set default 'A';
            alter table fitness.%1$I alter column created_at set default now();
            alter table fitness.%1$I alter column updated_at set default now();

            alter table fitness.%1$I alter column status     set not null;
            alter table fitness.%1$I alter column created_at set not null;
            alter table fitness.%1$I alter column updated_at set not null;
        $f$, t);

        -- Named constraint so the guard below can find it; a bare inline check
        -- would get a generated name and be added again on every re-run.
        if not exists (
            select 1 from pg_constraint
             where conname = format('%s_status_check', t)
               and conrelid = format('fitness.%I', t)::regclass
        ) then
            execute format(
                'alter table fitness.%1$I add constraint %2$I check (status in (''A'', ''I''))',
                t, format('%s_status_check', t));
        end if;

        -- `or replace` (Postgres 14+) makes this idempotent without a drop.
        execute format($f$
            create or replace trigger %2$I
                before insert or update on fitness.%1$I
                for each row execute function fitness.touch_audit()
        $f$, t, format('%s_audit', t));
    end loop;
end;
$$;

-- ------------------------------------------------- check it took

select table_name,
       count(*) filter (where column_name in
             ('status', 'created_at', 'created_by', 'updated_at', 'updated_by')) as audit_columns
  from information_schema.columns
 where table_schema = 'fitness'
 group by table_name
 order by table_name;
