import { MAX_TURNS, runTool, simplifySchema, type TurnRequest, type TurnResult } from './providers.ts'

/**
 * Google's Gemini, through the Interactions API.
 *
 * Written against the REST shapes at ai.google.dev rather than a client library: the
 * whole surface used here is one POST, and a dependency to spell it would be a
 * dependency to keep current.
 *
 * Two things to know before changing anything:
 *
 *  - It does not stream here. The docs describe function-call arguments arriving as
 *    partial deltas that the caller reassembles, and getting that wrong fails in a way
 *    that looks like the model being stupid rather than the code being wrong. The turn
 *    is fetched whole and handed to the browser in one go, which costs the typing
 *    effect and nothing else. Streaming is the obvious next step once real payloads
 *    have been seen.
 *  - The tool loop leans on server-side state: the first call stores the interaction,
 *    and the results go back by `previous_interaction_id`. That is exactly the shape
 *    the function-calling docs show, and the least guesswork available.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'

// deno-lint-ignore no-explicit-any
type Json = any

interface FunctionCall {
  id: string
  name: string
  // deno-lint-ignore no-explicit-any
  arguments: any
}

/** Pulls the calls out of a response, whichever level the steps arrive at. */
function callsOf(interaction: Json): FunctionCall[] {
  const steps: Json[] = interaction?.steps ?? interaction?.output ?? []
  return steps
    .filter((step) => step?.type === 'function_call')
    .map((step) => ({
      id: step.id ?? step.call_id ?? '',
      name: step.name,
      // Arguments come back parsed, but a string is cheap to allow for and expensive
      // to be surprised by.
      arguments: typeof step.arguments === 'string' ? safeJson(step.arguments) : (step.arguments ?? {}),
    }))
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

function textOf(interaction: Json): string {
  if (typeof interaction?.output_text === 'string') return interaction.output_text
  const steps: Json[] = interaction?.steps ?? interaction?.output ?? []
  return steps
    .filter((step) => step?.type === 'text' || step?.type === 'model_output')
    .map((step) => step.text ?? step.content ?? '')
    .join('')
}

async function post(body: Json, key: string): Promise<Json> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const text = await response.text()
  if (!response.ok) {
    // Gemini reports quota exhaustion as a 429 with a long message; the first line of
    // it is the part worth putting in front of someone.
    const detail = safeJson(text) as Json
    throw new Error(
      detail?.error?.message ?? `Gemini returned ${response.status}: ${text.slice(0, 200)}`,
    )
  }
  return safeJson(text)
}

export async function runGeminiTurn(request: TurnRequest): Promise<TurnResult> {
  const key = Deno.env.get('GEMINI_API_KEY')
  if (!key) throw new Error('The coach is not configured: GEMINI_API_KEY is not set.')

  const tools = request.tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: simplifySchema(tool.input_schema),
  }))

  /**
   * The conversation as one input array.
   *
   * The system prompt leads, and the history follows it labelled by speaker. The
   * Interactions API carries prior turns by `previous_interaction_id` instead, which
   * would mean this app storing Google's ids and losing the history the moment a
   * provider changed. Text we own is worth more than state we borrow.
   */
  const input: Json[] = [
    { type: 'text', text: request.system },
    ...request.history.map((turn) => ({
      type: 'text',
      text: `${turn.role === 'user' ? 'User' : 'Coach'}: ${turn.text}`,
    })),
    { type: 'text', text: `User: ${request.message}` },
  ]

  let interaction = await post(
    { model: request.model, input, tools, store: true },
    key,
  )

  let inputTokens = 0
  let outputTokens = 0
  const count = (result: Json) => {
    inputTokens += result?.usage?.prompt_tokens ?? 0
    outputTokens += result?.usage?.completion_tokens ?? 0
  }
  count(interaction)

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const calls = callsOf(interaction)
    if (calls.length === 0) break

    const results: Json[] = []
    for (const call of calls) {
      const outcome = await runTool(request, call.name, call.arguments)
      results.push({
        type: 'function_result',
        call_id: call.id,
        name: call.name,
        result: [{ type: 'text', text: outcome.content }],
      })
    }

    interaction = await post(
      {
        model: request.model,
        previous_interaction_id: interaction?.id ?? interaction?.interaction_id,
        input: results,
        tools,
        store: true,
      },
      key,
    )
    count(interaction)
  }

  const text = textOf(interaction)
  if (text) request.onText(text)

  return { text, inputTokens, outputTokens }
}
