-- Splits user_profile.display_name into first_name and last_name.
--
-- Run this ONCE, on a database created before the split. A fresh database gets
-- the new columns straight from 01_schema.sql and must skip this file.
-- Re-running it is harmless: every step is guarded.
--
-- Order matters only in that 03_api.sql must be re-run afterwards -- its
-- ensure_profile() now writes first_name/last_name and will not compile against
-- the old table.

alter table fitness.user_profile add column if not exists first_name text;
alter table fitness.user_profile add column if not exists last_name  text;

-- Backfill from whatever single-field names already exist. Everything before the
-- first space is the first name, the rest is the last name -- "Ada" alone leaves
-- last_name null, which the UI renders as just "Ada".
do $$
begin
    if exists (
        select 1 from information_schema.columns
         where table_schema = 'fitness'
           and table_name   = 'user_profile'
           and column_name  = 'display_name'
    ) then
        update fitness.user_profile
           set first_name = coalesce(first_name, nullif(split_part(trim(display_name), ' ', 1), '')),
               last_name  = coalesce(
                                last_name,
                                nullif(trim(substr(trim(display_name), strpos(trim(display_name), ' ') + 1)), '')
                            )
         where display_name is not null
           and (first_name is null or last_name is null);

        -- A single-word display_name puts the same word in both halves above,
        -- because strpos returns 0 when there is no space. Undo that.
        update fitness.user_profile
           set last_name = null
         where last_name is not null
           and last_name = first_name
           and display_name is not null
           and trim(display_name) not like '% %';

        alter table fitness.user_profile drop column display_name;
    end if;
end;
$$;
