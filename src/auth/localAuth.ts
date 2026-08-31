import type { Session } from '@supabase/supabase-js'

/**
 * A local stand-in for Supabase AUTH, used when no Supabase project is configured.
 *
 * It is deliberately auth-only: it never intercepts HTTP, so every API call still goes
 * to fitness-api over the network and every API failure is visible in the Network tab.
 * (The old src/mocks/ did intercept, which is why backend errors were invisible.)
 *
 * Delete this file and require VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY once
 * fitness-api validates tokens.
 */
const STORAGE_KEY = 'fitness-ui.local-session'

type Listener = (event: string, session: Session | null) => void

function buildSession(email: string, displayName: string): Session {
  const nowSeconds = Math.floor(Date.now() / 1000)
  return {
    access_token: 'local-dev-token',
    refresh_token: 'local-dev-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: nowSeconds + 60 * 60 * 24 * 365,
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email,
      email_confirmed_at: new Date().toISOString(),
      phone: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_sign_in_at: new Date().toISOString(),
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { display_name: displayName },
      identities: [],
    } as unknown as Session['user'],
  } as Session
}

function read(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      const session = buildSession('dev@localhost', 'Dev')
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
      return session
    }
    return raw === 'null' ? null : (JSON.parse(raw) as Session)
  } catch {
    return buildSession('dev@localhost', 'Dev')
  }
}

function write(session: Session | null): void {
  try {
    localStorage.setItem(STORAGE_KEY, session === null ? 'null' : JSON.stringify(session))
  } catch {
    // Storage unavailable — the in-memory value still works.
  }
}

export function createLocalAuth() {
  let session: Session | null = read()
  const listeners = new Set<Listener>()

  const emit = (event: string) => {
    for (const listener of listeners) listener(event, session)
  }

  return {
    auth: {
      async getSession() {
        return { data: { session }, error: null }
      },
      async getUser() {
        return { data: { user: session?.user ?? null }, error: null }
      },
      onAuthStateChange(callback: Listener) {
        listeners.add(callback)
        return {
          data: {
            subscription: {
              id: 'local-subscription',
              callback,
              unsubscribe: () => listeners.delete(callback),
            },
          },
        }
      },
      async signInWithPassword({ email }: { email: string; password: string }) {
        session = buildSession(email, email.split('@')[0] || 'Dev')
        write(session)
        emit('SIGNED_IN')
        return { data: { session, user: session.user }, error: null }
      },
      async signUp({
        email,
        options,
      }: {
        email: string
        password: string
        options?: { data?: { display_name?: string } }
      }) {
        session = buildSession(email, options?.data?.display_name ?? 'Dev')
        write(session)
        emit('SIGNED_IN')
        return { data: { session, user: session.user }, error: null }
      },
      async signOut() {
        session = null
        write(null)
        emit('SIGNED_OUT')
        return { error: null }
      },
      async resetPasswordForEmail() {
        return { data: {}, error: null }
      },
    },
  }
}
