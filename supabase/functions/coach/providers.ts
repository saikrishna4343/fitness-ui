import type { CoachContext, CoachTool } from './tools.ts'

/**
 * The seam between the coach and whoever is answering it.
 *
 * Two providers, chosen by the model name in COACH_MODEL, because the reason to have
 * one is cost and the reason to keep the other is that cost is not the only thing that
 * matters. Swapping is an environment variable, not a deploy.
 *
 * What makes this cheap to do at all is that replay is text-only (see `replayable` in
 * index.ts): the conversation crossing this boundary is plain text, so neither
 * provider's content-block format has to be understood by the other, or by the
 * database. Tool traffic lives and dies inside a single turn.
 */

export interface TurnMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface TurnRequest {
  model: string
  /** The system prompt, plus the line telling it today's date. */
  system: string
  history: TurnMessage[]
  message: string
  tools: CoachTool[]
  // deno-lint-ignore no-explicit-any
  db: any
  ctx: CoachContext
  /** Called as the answer arrives, or once with the whole thing where a provider cannot stream. */
  onText: (delta: string) => void
  onTool: (name: string, writes: boolean) => void
  onWrote: (name: string, result: unknown) => void
}

export interface TurnResult {
  text: string
  inputTokens: number
  outputTokens: number
  /** Set when the provider declined rather than answered. */
  refused?: boolean
}

/** Read tool, write tool, answer. More than this is a loop, not a conversation. */
export const MAX_TURNS = 6

/**
 * Runs one tool call and turns the result into something a model can read.
 *
 * Shared because it is the half neither provider has an opinion about: a failure comes
 * back as a result rather than an exception, since a model that can see the error can
 * explain it, and a thrown one just kills the stream.
 */
export async function runTool(
  request: TurnRequest,
  name: string,
  // deno-lint-ignore no-explicit-any
  input: any,
): Promise<{ ok: boolean; content: string }> {
  const tool = request.tools.find((candidate) => candidate.name === name)
  request.onTool(name, tool?.writes ?? false)

  try {
    if (!tool) throw new Error(`No tool named ${name}`)
    const result = await tool.run(request.db, input ?? {}, request.ctx)
    if (tool.writes) request.onWrote(name, result)
    return { ok: true, content: JSON.stringify(result) }
  } catch (error) {
    return { ok: false, content: error instanceof Error ? error.message : 'Tool failed' }
  }
}

/**
 * Gemini accepts only a subset of OpenAPI schema — type, properties, required, items,
 * enum, description — and rejects the rest rather than ignoring it.
 *
 * The tool definitions are written for Anthropic, which takes full JSON Schema, so they
 * carry `additionalProperties` and a couple of `["number", "null"]` unions. Both are
 * stripped here rather than removed from the definitions: they earn their place on the
 * provider that understands them, and a union collapses to its first real type, which
 * is what "nullable" meant anyway.
 */
export function simplifySchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(simplifySchema)
  if (typeof schema !== 'object' || schema === null) return schema

  const source = schema as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const key of ['description', 'enum', 'required']) {
    if (key in source) out[key] = source[key]
  }

  if ('type' in source) {
    const type = source.type
    if (Array.isArray(type)) {
      // ["number", "null"] is how the Anthropic definitions say "optional". Gemini has
      // no union types, so it collapses to the real one plus a nullable flag.
      const real = type.find((entry) => entry !== 'null')
      out.type = real ?? 'string'
      if (type.includes('null')) out.nullable = true
    } else {
      out.type = type
    }
  }

  // `properties` is a bag of names, not a schema: recursing into it as one would filter
  // the property names themselves against the keyword list and leave it empty.
  if (source.properties && typeof source.properties === 'object') {
    out.properties = Object.fromEntries(
      Object.entries(source.properties as Record<string, unknown>).map(([name, value]) => [
        name,
        simplifySchema(value),
      ]),
    )
  }

  if (source.items) out.items = simplifySchema(source.items)

  return out
}
