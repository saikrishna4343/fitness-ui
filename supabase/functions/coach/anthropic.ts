import Anthropic from 'npm:@anthropic-ai/sdk'
import { MAX_TURNS, runTool, type TurnRequest, type TurnResult } from './providers.ts'

/**
 * Anthropic, kept alongside Gemini rather than replaced by it.
 *
 * It streams, which Gemini does not here, and it is the one to fall back to when a free
 * tier runs out of quota mid-session. Selected by COACH_MODEL starting with "claude".
 */

/** A cap, not a target. The prompt asks for two or three sentences. */
const MAX_TOKENS = 8192

export async function runAnthropicTurn(request: TurnRequest): Promise<TurnResult> {
  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!key) throw new Error('The coach is not configured: ANTHROPIC_API_KEY is not set.')

  const anthropic = new Anthropic({ apiKey: key })

  const tools = request.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }))

  // deno-lint-ignore no-explicit-any
  const messages: any[] = [
    ...request.history.map((turn) => ({
      role: turn.role,
      content: [{ type: 'text', text: turn.text }],
    })),
    { role: 'user', content: [{ type: 'text', text: request.message }] },
  ]

  let answer = ''
  let inputTokens = 0
  let outputTokens = 0

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const run = anthropic.messages.stream({
      model: request.model,
      max_tokens: MAX_TOKENS,
      // Cheap and quick for chat. A daily brief would want "high".
      output_config: { effort: 'low' },
      // The cached prefix. The system prompt is byte-identical between requests; the
      // date line that follows it is not, which is why it is a separate block after
      // the breakpoint.
      system: [
        {
          type: 'text',
          text: request.system,
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
      ],
      // deno-lint-ignore no-explicit-any
      tools: tools as any,
      messages,
    })

    run.on('text', (delta: string) => {
      answer += delta
      request.onText(delta)
    })

    const reply = await run.finalMessage()
    inputTokens += reply.usage?.input_tokens ?? 0
    outputTokens += reply.usage?.output_tokens ?? 0
    messages.push({ role: 'assistant', content: reply.content })

    if (reply.stop_reason === 'refusal') return { text: answer, inputTokens, outputTokens, refused: true }
    if (reply.stop_reason !== 'tool_use') break

    // Every tool_result goes back in ONE user message. Splitting them across several
    // teaches the model to stop calling tools in parallel.
    // deno-lint-ignore no-explicit-any
    const results: any[] = []
    for (const block of reply.content) {
      if (block.type !== 'tool_use') continue
      const outcome = await runTool(request, block.name, block.input)
      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        is_error: outcome.ok ? undefined : true,
        content: outcome.content,
      })
    }
    messages.push({ role: 'user', content: results })
  }

  return { text: answer, inputTokens, outputTokens }
}
