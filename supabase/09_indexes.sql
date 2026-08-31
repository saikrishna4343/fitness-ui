-- Indexes for the access paths the app actually uses.
--
-- Most were already right in 01_schema.sql, and a B-tree serves any PREFIX of
-- its columns -- so every `where user_id = ?` is already covered as a leading
-- column and needs nothing here:
--
--   user_profile     user_id is the primary key
--   daily_goal       primary key (user_id, goal_date)
--   food_entry       food_entry_user_date_idx (user_id, entry_date)
--   plan             plan_user_idx (user_id)
--   workout_session  unique (user_id, session_date)
--   plan_day         unique (plan_id, day_of_week)
--   plan_exercise    plan_exercise_day_idx (plan_day_id, order_index)
--   session_exercise session_exercise_session_idx (session_id, order_index)
--
-- A second single-column index on user_id for any of those would never be
-- chosen by the planner and would only slow writes down. What follows is the
-- two paths that were NOT covered.
--
-- Safe to re-run.

-- ------------------------------------------------- the unindexed foreign key
--
-- food_entry.food_id references food (id) ON DELETE SET NULL. Postgres has to
-- find the referencing rows before it can null them, and with no index on the
-- child column that is a full scan of food_entry for every food deleted --
-- the one operation here that gets slower as the food log grows.
--
-- Partial, because food_id is null for an ad-hoc entry that was never saved as
-- a food, and those rows can never match the delete. Keeps the index to the
-- rows that can.
create index if not exists food_entry_food_idx
    on fitness.food_entry (food_id)
    where food_id is not null;

-- ------------------------------------------------- the saved-food list
--
-- useFoods() is `select ... order by name`, with RLS adding user_id = auth.uid().
-- The existing pair indexes lower(name) and lower(brand), which an ORDER BY on
-- the raw column cannot use -- so that query filtered on the index and then
-- sorted anyway. This serves the filter and the sort from one index.
create index if not exists food_user_name_sort_idx
    on fitness.food (user_id, name);

-- The two lower() indexes were built for a case-insensitive prefix search that
-- was never written. The search is `ilike '%term%'` -- a LEADING wildcard, which
-- no B-tree can serve, lower() or not -- so they are pure write overhead today.
drop index if exists fitness.food_user_name_idx;
drop index if exists fitness.food_user_brand_idx;

-- If that search ever gets slow, trigrams are the fix, not a B-tree. A saved-food
-- list is a few dozen rows per user, so this is deliberately left off: a GIN
-- index on a tiny table costs more to maintain than the scan it replaces.
--
--   create extension if not exists pg_trgm;
--   create index food_name_trgm_idx  on fitness.food using gin (name  gin_trgm_ops);
--   create index food_brand_trgm_idx on fitness.food using gin (brand gin_trgm_ops);

-- ------------------------------------------------- check it took

select tablename, indexname
  from pg_indexes
 where schemaname = 'fitness'
 order by tablename, indexname;
