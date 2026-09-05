/**
 * The coach.
 *
 * This is the only server-side code in the app, and it exists for exactly one
 * reason: the Anthropic API key cannot ship in the browser bundle. The anon key
 * there is public by design and RLS protects the data behind it; an API key has
 * no such protection, and anyone with DevTools could spend it.
 *
 * Deploy:
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *   supabase functions deploy coach
 *
 * SUPABASE_URL and SUPABASE_ANON_KEY are injected by the platform; there is no
 * service-role key here on purpose — see the note on `db` below.
 */
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { COACH_PROMPT } from './prompt.ts'
import { TOOL_DEFINITIONS, TOOLS_BY_NAME, type CoachContext } from './tools.ts'

const MODEL = 'claude-opus-5'
/** A cap, not a target. The prompt asks for two or three sentences. */
const MAX_TOKENS = 8192
/** Read tool, write tool, answer. More than this is a loop, not a conversation. */
const MAX_TURNS = 6
/**
 * Replay is text-only, short, and recent -- see `replayable` below for why.
 * The table keeps everything; these numbers only govern what is re-sent.
 */
const REPLAY_MESSAGES = 12
const REPLAY_WINDOW_HOURS = 12
const DAILY_LIMIT = 40

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })

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

/** Text blocks only, as the model's own message shape. */
function textOnly(content: unknown): { type: 'text'; text: string }[] {
  if (typeof content === 'string') {
    return content.trim() ? [{ type: 'text', text: content }] : []
  }
  if (!Array.isArray(content)) return []
  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: string }).type === 'text' &&
        typeof (block as { text?: string }).text === 'string' &&
        (block as { text: string }).text.trim().length > 0,
    )
    .map((block) => ({ type: 'text', text: block.text }))
}

/**
 * What gets re-sent to the model, and deliberately not much.
 *
 * Tool calls and their results are stripped. They are the expensive part by a wide
 * margin -- three weeks of training history is a page of JSON, and replaying it on
 * every message pays for the same rows again and again -- and they are the part the
 * model can simply fetch again, fresher, for the price of one tool call. What it
 * cannot fetch again is what was *said*: "add them to today" only means anything
 * next to the message listing them. So the words stay and the data goes.
 *
 * History also expires. A conversation from this morning still applies at dinner;
 * one from last week is about a different day and is not worth paying to re-read.
 */
function replayable(
  rows: { role: 'user' | 'assistant'; content: unknown }[],
): { role: 'user' | 'assistant'; content: unknown }[] {
  const kept = rows
    .slice()
    .reverse()
    .map((row) => ({ role: row.role, content: textOnly(row.content) }))
    .filter((row) => row.content.length > 0)
    .slice(-REPLAY_MESSAGES)

  // A turn that was nothing but tool traffic leaves an assistant message at the
  // front once the tool blocks are gone, and the API requires a user message first.
  while (kept.length > 0 && kept[0].role === 'assistant') kept.shift()

  return kept
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'Not signed in' }, 401)

  if (!Deno.env.get('ANTHROPIC_API_KEY')) {
    return json({ error: 'The coach is not configured: ANTHROPIC_API_KEY is not set.' }, 503)
  }

  /**
   * Built from the caller's own JWT, and this is the whole security model: every
   * tool query runs as that user, so row level security scopes it in the database.
   * A service-role client here would bypass every policy and make the model's
   * reach a matter of how carefully the tools were written.
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

  // Resolves the caller and validates the token in one call. RLS would refuse a
  // forged one anyway, but failing here gives a usable message and costs nothing.
  const { data: userData, error: userError } = await db.auth.getUser()
  if (userError || !userData?.user) return json({ error: 'Your session has expired' }, 401)
  const ctx: CoachContext = { userId: userData.user.id }

  let message: string
  try {
    const body = await req.json()
    message = String(body?.message ?? '').trim()
  } catch {
    return json({ error: 'Expected a JSON body' }, 400)
  }
  if (!message) return json({ error: 'Say something first' }, 400)
  if (message.length > 4000) return json({ error: 'That message is too long' }, 400)

  // Claimed before the API call and in one statement, so two tabs cannot both
  // read the same count and both proceed.
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

  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [
    ...replayable(history.data ?? []),
    { role: 'user' as const, content: [{ type: 'text', text: message }] },
  ]

  // Everything produced this exchange, written to the table in full: the transcript
  // is the record of what the coach actually did, and the loop below needs the tool
  // blocks intact while it runs. Only the *replay* drops them.
  const transcript: { role: string; content: unknown }[] = [
    { role: 'user', content: [{ type: 'text', text: message }] },
  ]

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))

      let inputTokens = 0
      let outputTokens = 0

      try {
        for (let turnIndex = 0; turnIndex < MAX_TURNS; turnIndex += 1) {
          const run = anthropic.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            // Cheap and quick for chat. The daily brief will want "high".
            output_config: { effort: 'low' },
            // The cached prefix. Tools render before system, so one breakpoint
            // here covers both -- and both must be byte-identical between
            // requests or the cache silently misses.
            system: [
              { type: 'text', text: COACH_PROMPT, cache_control: { type: 'ephemeral', ttl: '1h' } },
            ],
            tools: TOOL_DEFINITIONS,
            // deno-lint-ignore no-explicit-any
            messages: messages as any,
          })

          run.on('text', (delta: string) => send({ type: 'text', delta }))

          const reply = await run.finalMessage()
          inputTokens += reply.usage?.input_tokens ?? 0
          outputTokens += reply.usage?.output_tokens ?? 0

          messages.push({ role: 'assistant', content: reply.content })
          transcript.push({ role: 'assistant', content: reply.content })

          if (reply.stop_reason === 'refusal') {
            send({ type: 'error', message: 'The model declined to answer that one.' })
            break
          }
          if (reply.stop_reason !== 'tool_use') break

          // Every tool_result goes back in ONE user message. Splitting them
          // across several teaches the model to stop calling tools in parallel.
          const results: unknown[] = []
          for (const block of reply.content) {
            if (block.type !== 'tool_use') continue

            const tool = TOOLS_BY_NAME.get(block.name)
            send({ type: 'tool', name: block.name, writes: tool?.writes ?? false })

            try {
              if (!tool) throw new Error(`No tool named ${block.name}`)
              const result = await tool.run(db, block.input ?? {}, ctx)
              results.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: JSON.stringify(result),
              })
              if (tool.writes) send({ type: 'wrote', name: block.name, result })
            } catch (error) {
              // Handed back as a failed result rather than thrown: the model can
              // explain the failure, which is more useful than a dead stream.
              results.push({
                type: 'tool_result',
                tool_use_id: block.id,
                is_error: true,
                content: error instanceof Error ? error.message : 'Tool failed',
              })
            }
          }

          messages.push({ role: 'user', content: results })
          transcript.push({ role: 'user', content: results })
        }

        const now = Date.now()
        await db.from('coach_message').insert(
          transcript.map((row, index) => ({
            role: row.role,
            content: row.content,
            // Explicit and increasing: a batch insert would otherwise share one
            // now() and the replay order would be undefined.
            created_at: new Date(now + index * 10).toISOString(),
          })),
        )
        await db.rpc('coach_record_usage', { p_input: inputTokens, p_output: outputTokens })

        send({ type: 'done' })
      } catch (error) {
        console.error('[coach]', error)
        send({
          type: 'error',
          message: error instanceof Error ? error.message : 'The coach could not answer',
        })
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
