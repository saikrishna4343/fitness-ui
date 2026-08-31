import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createLocalAuth } from '@/auth/localAuth'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** True when no Supabase project is configured, so auth falls back to a local session. */
export const usingLocalAuth = !url || !anonKey

if (usingLocalAuth && import.meta.env.DEV) {
  console.info(
    '[auth] No Supabase project configured — using a local session. Any email and ' +
      'password signs you in. API calls are NOT mocked; they go to VITE_API_BASE_URL.',
  )
}

/**
 * Supabase is used for authentication only — all app data goes through fitness-api.
 * There is no request mocking anywhere in this app: if the API is down or erroring,
 * you see it in the Network tab.
 */
/**
 * Loose generics on purpose. `db.schema` below changes the client's schema type
 * parameter away from the default "public", which no longer matches a bare
 * SupabaseClient. Generating real database types would fix this properly:
 *   npx supabase gen types typescript --project-id <your-project-ref> --schema fitness
 */
type FitnessClient = SupabaseClient<any, any, any, any, any>

export const supabase: FitnessClient = usingLocalAuth
  ? (createLocalAuth() as unknown as SupabaseClient)
  : createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      // Every table lives in `fitness`, not `public`. Without this, PostgREST
      // resolves bare table names against `public` and every query 404s.
      // The schema must ALSO be on the project's exposed list:
      // Dashboard -> Integrations -> Data API -> Settings -> Exposed schemas.
      db: { schema: 'fitness' },
    })
