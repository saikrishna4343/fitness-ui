import { MAX_TURNS, runTool, type TurnRequest, type TurnResult } from './providers.ts'

/**
 * OpenAI, through Chat Completions. Selected by COACH_MODEL starting with "gpt" or "o<digit>".
 *
 * Plain fetch rather than the SDK, for the same reason as gemini.ts: one POST is the
 * whole surface. Chat Completions is stateless, so the history stays text this app owns
 * instead of ids on someone else's server.
 *
 *  - It does not stream here. Streamed tool-call arguments arrive as fragments to be
 *    joined by index; the answer is fetched whole and handed over in one go, the same
 *    trade gemini.ts makes.
 *  - No `simplifySchema()`: non-strict function calling takes full JSON Schema, so the
 *    Anthropic definitions pass through as written.
 *  - Prompt caching is automatic for long repeated prefixes. The system prompt leads and
 *    the date line trails it, which is all it needs.
 */

const ENDPOINT = 'https://api.openai.com/v1/chat/completions'

// deno-lint-ignore no-explicit-any
type Json = any

function safeJson(text: string): Json {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

async function post(body: Json, key: string): Promise<Json> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const text = await response.text()
  if (!response.ok) {
    const detail = safeJson(text)
    throw new Error(
      detail?.error?.message ?? `OpenAI returned ${response.status}: ${text.slice(0, 200)}`,
    )
  }
  return safeJson(text)
}

export async function runOpenAiTurn(request: TurnRequest): Promise<TurnResult> {
  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) throw new Error('The coach is not configured: OPENAI_API_KEY is not set.')

  const tools = request.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }))

  const messages: Json[] = [
    { role: 'system', content: request.system },
    ...request.history.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: 'user', content: request.message },
  ]

  let text = ''
  let inputTokens = 0
  let outputTokens = 0

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const completion = await post(
      {
        model: request.model,
        messages,
        tools,
        // Reasoning models bill their thinking as output tokens. Chat wants little of
        // it, but "minimal" risks the judgement about which tool to call.
        reasoning_effort: 'low',
      },
      key,
    )
    inputTokens += completion?.usage?.prompt_tokens ?? 0
    outputTokens += completion?.usage?.completion_tokens ?? 0

    const message = completion?.choices?.[0]?.message
    if (message?.refusal) return { text: '', inputTokens, outputTokens, refused: true }

    text = typeof message?.content === 'string' ? message.content.trim() : ''

    const calls: Json[] = message?.tool_calls ?? []
    if (calls.length === 0) break

    // The assistant message carrying the calls goes back first, or the tool results
    // that follow it are rejected as answering nothing.
    messages.push(message)
    for (const call of calls) {
      const outcome = await runTool(request, call.function?.name, safeJson(call.function?.arguments ?? '{}'))
      messages.push({ role: 'tool', tool_call_id: call.id, content: outcome.content })
    }
  }

  if (text) request.onText(text)
  return { text, inputTokens, outputTokens }
}
