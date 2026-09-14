/**
 * The coach.
 *
 * This is the only server-side code in the app, and it exists for exactly one reason:
 * a model provider's API key cannot ship in the browser bundle. The anon key there is
 * public by design and RLS protects the data behind it; an API key has no such
 * protection, and anyone with DevTools could spend it.
 *
 * Deploy:
 *   supabase secrets set OPENAI_API_KEY=...        (or GEMINI_API_KEY, ANTHROPIC_API_KEY)
 *   supabase secrets set COACH_MODEL=gpt-5-mini
 *   supabase functions deploy coach
 *
 * SUPABASE_URL and SUPABASE_ANON_KEY are injected by the platform; there is no
 * service-role key here on purpose — see the note on `db` below.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { runAnthropicTurn } from './anthropic.ts'
import { runGeminiTurn } from './gemini.ts'
import { runOpenAiTurn } from './openai.ts'
import { COACH_PROMPT } from './prompt.ts'
import { TOOLS, type CoachContext } from './tools.ts'
import type { TurnMessage, TurnRequest } from './providers.ts'

/**
 * Which model answers, and therefore which provider.
 *
 * An environment variable, so switching is a secret change rather than a code change —
 * which matters when the reason to switch is a free tier running out mid-session.
 * Anything starting "claude" goes to Anthropic, "gpt" or "o<digit>" to OpenAI, and
 * everything else to Gemini.
 *
 * Normalised because a secret pasted as "GPT-5-mini" or with its quotes still on would
 * otherwise fall through to Gemini and fail there, naming the wrong provider.
 */
const MODEL =
  Deno.env.get('COACH_MODEL')?.trim().replace(/^["']|["']$/g, '').trim().toLowerCase() ||
  'gpt-5-mini'

const PROVIDER = MODEL.startsWith('claude') ? 'anthropic' : /^(gpt|o\d)/.test(MODEL) ? 'openai' : 'gemini'
console.log(`[coach] model=${MODEL} provider=${PROVIDER}`)

/** Messages replayed to the model. Older ones stay in the table for the UI. */
const REPLAY_MESSAGES = 12
const REPLAY_WINDOW_HOURS = 12
const DAILY_LIMIT = 40

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

/**
 * The one thing the model cannot work out for itself.
 *
 * Without this, "add these tomorrow" is unanswerable: a model has no clock, and asking
 * the user what day it is would be absurd.
 */
function todayLine(date: string): string {
  // Parsed as UTC midnight so the weekday is read off the date as given, with no second
  // timezone shift applied to a date that has already been localised once.
  const at = new Date(`${date}T00:00:00Z`)
  const weekday = at.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })
  // ISO day of week, which is what add_plan_exercises takes: 1 Monday ... 7 Sunday.
  const iso = ((at.getUTCDay() + 6) % 7) + 1
  return `Today is ${weekday} ${date}. ISO day of week ${iso} (1 Monday ... 7 Sunday).`
}

/** yyyy-MM-dd, and a real one -- this reaches the database as a date. */
const isDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())

/** The readable text of a stored turn. */
function textOnly(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: string }).type === 'text' &&
        typeof (block as { text?: string }).text === 'string',
    )
    .map((block) => block.text)
    .join('\n')
    .trim()
}

/**
 * What gets re-sent to the model, and deliberately not much.
 *
 * Only the words. Tool results were the expensive part by a wide margin -- three weeks
 * of training history is a page of JSON, billed again on every message since history
 * sits after any cache breakpoint -- and they are the part the model can simply fetch
 * again, fresher, for the price of one tool call. What it cannot fetch again is what
 * was *said*: "add them to today" means nothing next to the message listing them.
 *
 * Being text-only is also what lets the provider change without the stored conversation
 * meaning anything different.
 */
function replayable(rows: { role: 'user' | 'assistant'; content: unknown }[]): TurnMessage[] {
  const kept = rows
    .slice()
    .reverse()
    .map((row) => ({ role: row.role, text: textOnly(row.content) }))
    .filter((row) => row.text.length > 0)
    .slice(-REPLAY_MESSAGES)

  // The first message must be from the user.
  while (kept.length > 0 && kept[0].role === 'assistant') kept.shift()
  return kept
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'Not signed in' }, 401)

  /**
   * Built from the caller's own JWT, and this is the whole security model: every tool
   * query runs as that user, so row level security scopes it in the database. A
   * service-role client here would bypass every policy and make the model's reach a
   * matter of how carefully the tools were written.
   */
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
      db: { schema: 'fitness' },
    },
  )

  let message: string
  // The browser's own calendar date. The function runs in UTC, which is a different day
  // from about 7pm Central onwards -- close enough to dinner to matter.
  let today = new Date().toISOString().slice(0, 10)
  try {
    const body = await req.json()
    message = String(body?.message ?? '').trim()
    if (isDate(body?.today)) today = body.today
  } catch {
    return json({ error: 'Expected a JSON body' }, 400)
  }
  if (!message) return json({ error: 'Say something first' }, 400)
  if (message.length > 4000) return json({ error: 'That message is too long' }, 400)

  // Resolves the caller and validates the token in one call. RLS would refuse a forged
  // one anyway, but failing here gives a usable message and costs nothing.
  const { data: userData, error: userError } = await db.auth.getUser()
  if (userError || !userData?.user) return json({ error: 'Your session has expired' }, 401)
  const ctx: CoachContext = { userId: userData.user.id, today }

  // Claimed before the API call and in one statement, so two tabs cannot both read the
  // same count and both proceed.
  const turn = await db.rpc('coach_take_turn', { p_limit: DAILY_LIMIT })
  if (turn.error) return json({ error: turn.error.message }, 401)
  const claim = turn.data?.[0]
  if (claim && !claim.allowed) {
    return json(
      { error: `That is ${claim.day_limit} messages today — the coach is done until tomorrow.` },
      429,
    )
  }

  const since = new Date(Date.now() - REPLAY_WINDOW_HOURS * 3600_000).toISOString()
  const history = await db
    .from('coach_message')
    .select('role, content')
    .eq('status', 'A')
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(REPLAY_MESSAGES * 4)
  if (history.error) return json({ error: history.error.message }, 400)

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))

      try {
        const request: TurnRequest = {
          model: MODEL,
          system: `${COACH_PROMPT}\n\n${todayLine(today)}`,
          history: replayable(history.data ?? []),
          message,
          tools: TOOLS,
          db,
          ctx,
          onText: (delta) => send({ type: 'text', delta }),
          onTool: (name, writes) => send({ type: 'tool', name, writes }),
          onWrote: (name, result) => send({ type: 'wrote', name, result }),
        }

        const result =
          PROVIDER === 'anthropic'
            ? await runAnthropicTurn(request)
            : PROVIDER === 'openai'
              ? await runOpenAiTurn(request)
              : await runGeminiTurn(request)

        if (result.refused) {
          send({ type: 'error', message: 'The model declined to answer that one.' })
        }

        // Both turns, as text. The tool traffic is not stored: it is never replayed, and
        // keeping one provider's block format in the table would tie the transcript to
        // whichever model happened to write it.
        const now = Date.now()
        await db.from('coach_message').insert(
          [
            { role: 'user', content: [{ type: 'text', text: message }] },
            { role: 'assistant', content: [{ type: 'text', text: result.text }] },
          ]
            .filter((row) => textOnly(row.content).length > 0)
            // Explicit and increasing: a batch insert would otherwise share one now()
            // and the replay order would be undefined.
            .map((row, index) => ({ ...row, created_at: new Date(now + index * 10).toISOString() })),
        )
        await db.rpc('coach_record_usage', {
          p_input: result.inputTokens,
          p_output: result.outputTokens,
        })

        send({ type: 'done' })
      } catch (error) {
        console.error('[coach]', MODEL, PROVIDER, error)
        // Prefixed with the provider, so "which code is deployed, which secret is read"
        // is answered by the error itself rather than by a trip to the logs.
        const detail = error instanceof Error ? error.message : 'The coach could not answer'
        send({ type: 'error', message: `[${PROVIDER} · ${MODEL}] ${detail}` })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      ...CORS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
})
