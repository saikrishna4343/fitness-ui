import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { ApiError } from '@/lib/api'
import { toIsoDate } from '@/lib/format'
import { supabase, usingLocalAuth } from '@/lib/supabase'
import type { CoachEvent, CoachMessage, CoachRole } from '@/types/coach'

/**
 * The coach's half of the network layer.
 *
 * Deliberately not in `src/api/hooks.ts`, which is otherwise the only module that
 * touches the network: this one talks to an edge function rather than PostgREST,
 * and it streams. TanStack Query is built around a request that resolves once,
 * and a token stream is not that. Everything else here — the stored transcript —
 * is a normal query and follows the same rules as the rest of the app.
 */

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/coach`

export const coachKeys = { history: ['coach-history'] as const }

/** True when there is no Supabase project, so there is no function to call either. */
export const coachAvailable = !usingLocalAuth

type MessageRow = {
  id: string
  role: CoachRole
  content: unknown
  created_at: string
}

/**
 * Pulls the readable text out of a stored turn.
 *
 * A row's content is the raw content-block array, because the model has to be
 * replayed exactly. Tool calls and their results live in there too — those turns
 * flatten to nothing, and drop out of the list.
 */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type: 'text'; text: string } =>
      typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text',
    )
    .map((block) => block.text)
    .join('\n')
    .trim()
}

export function useCoachHistory() {
  return useQuery({
    queryKey: coachKeys.history,
    enabled: coachAvailable,
    queryFn: async (): Promise<CoachMessage[]> => {
      const { data, error } = await supabase
        .from('coach_message')
        .select('id, role, content, created_at')
        .eq('status', 'A')
        .order('created_at')
        .limit(200)
      if (error) throw new ApiError(400, error.message)

      return (data as MessageRow[])
        .map((row) => ({
          id: row.id,
          role: row.role,
          text: textOf(row.content),
          createdAt: row.created_at,
        }))
        .filter((message) => message.text.length > 0)
    },
  })
}

/** Hides the conversation rather than deleting it — the transcript is the user's. */
export function useClearCoach() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('coach_message')
        .update({ status: 'I' })
        .eq('status', 'A')
      if (error) throw new ApiError(400, error.message)
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: coachKeys.history })
    },
  })
}

export interface CoachChat {
  /** The assistant text so far this turn. Empty when nothing is in flight. */
  streaming: string
  /** What a tool is doing right now, for the status line. */
  activity: string | null
  sending: boolean
  error: string | null
  /** The message being answered, shown immediately rather than after the round trip. */
  pending: string | null
  send: (message: string) => Promise<void>
}

export function useCoachChat(): CoachChat {
  const client = useQueryClient()
  const [streaming, setStreaming] = useState('')
  const [activity, setActivity] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const inFlight = useRef(false)

  const send = useCallback(
    async (message: string) => {
      // A second submit while the first is streaming would interleave two answers
      // into one bubble, and bill for both.
      if (inFlight.current) return
      inFlight.current = true

      setSending(true)
      setError(null)
      setStreaming('')
      setActivity(null)
      setPending(message)

      let wrote = false

      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (!token) throw new Error('Your session has expired. Sign in again.')

        const response = await fetch(FUNCTIONS_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          // The date is the browser's, not the server's: the function runs in UTC and
          // would otherwise log an evening meal to tomorrow. Same rule as the rest of
          // the app -- dates are yours, not the server's.
          body: JSON.stringify({ message, today: toIsoDate(new Date()) }),
        })

        // Everything that fails before the stream starts answers with JSON: not
        // signed in, over the daily cap, no API key configured.
        if (!response.ok || !response.body) {
          const body = await response.json().catch(() => null)
          throw new Error(body?.error ?? `The coach is unreachable (${response.status})`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          // Frames are separated by a blank line, and the last chunk of a read is
          // usually half a frame — so anything after the final separator stays in
          // the buffer until the rest of it arrives.
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''

          for (const frame of frames) {
            const line = frame.split('\n').find((part) => part.startsWith('data: '))
            if (!line) continue

            let event: CoachEvent
            try {
              event = JSON.parse(line.slice(6)) as CoachEvent
            } catch {
              continue
            }

            if (event.type === 'text') {
              setStreaming((current) => current + event.delta)
              setActivity(null)
            } else if (event.type === 'tool') {
              setActivity(event.name)
            } else if (event.type === 'wrote') {
              wrote = true
            } else if (event.type === 'error') {
              setError(event.message)
            }
          }
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'The coach could not answer')
      } finally {
        // The function stores both turns, so the list is refetched rather than
        // patched — one source of truth for what was said.
        void client.invalidateQueries({ queryKey: coachKeys.history })
        if (wrote) {
          // A tool changed the log. Everything derived from a day has to catch up.
          void client.invalidateQueries({ queryKey: ['workout'] })
          void client.invalidateQueries({ queryKey: ['summary'] })
          void client.invalidateQueries({ queryKey: ['summary-range'] })
          void client.invalidateQueries({ queryKey: ['food-entries'] })
          // The coach can now edit the weekly plan too, and a plan edit changes what a
          // future day materialises as.
          void client.invalidateQueries({ queryKey: ['plan'] })
        }
        setStreaming('')
        setActivity(null)
        setPending(null)
        setSending(false)
        inFlight.current = false
      }
    },
    [client],
  )

  return { streaming, activity, sending, error, pending, send }
}
