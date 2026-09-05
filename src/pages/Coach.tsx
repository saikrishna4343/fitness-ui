import { ArrowUp, Eraser, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { coachAvailable, useClearCoach, useCoachChat, useCoachHistory } from '@/api/coach'
import { PageHeader } from '@/components/AppShell'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { TOOL_ACTIVITY, type CoachMessage } from '@/types/coach'

const OPENERS = [
  'How many calories should I eat today?',
  'What should I train today?',
  'How did last week look?',
]

export default function Coach() {
  const [draft, setDraft] = useState('')
  const { data: history, isLoading } = useCoachHistory()
  const chat = useCoachChat()
  const clear = useClearCoach()
  const bottom = useRef<HTMLDivElement>(null)

  // Follows the answer as it streams. Not smooth: a smooth scroll cannot keep up
  // with tokens arriving, and lags a line or two behind for the whole reply.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [history, chat.streaming, chat.pending])

  function submit(event: FormEvent) {
    event.preventDefault()
    const message = draft.trim()
    if (!message || chat.sending) return
    setDraft('')
    void chat.send(message)
  }

  if (!coachAvailable) {
    return (
      <>
        <PageHeader title="Coach" />
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            The coach needs a Supabase project — it runs in an edge function, which is also the
            only place the Anthropic key lives. Set <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env.local</code> and restart the dev
            server.
          </CardContent>
        </Card>
      </>
    )
  }

  const empty = !isLoading && (history?.length ?? 0) === 0 && !chat.pending

  return (
    <>
      <PageHeader
        title="Coach"
        description="Meals and training only — it reads your own log to answer."
        actions={
          (history?.length ?? 0) > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-muted-foreground"
              disabled={clear.isPending}
              onClick={() =>
                clear.mutate(undefined, {
                  onSuccess: () => toast('Conversation cleared'),
                  onError: (error) => toast.error(error.message),
                })
              }
            >
              <Eraser className="size-4" />
              Clear
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex min-h-[52svh] flex-col gap-4">
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : empty ? (
            <Empty onPick={(text) => void chat.send(text)} disabled={chat.sending} />
          ) : (
            history?.map((message) => <Bubble key={message.id} message={message} />)
          )}

          {chat.pending && <Bubble message={{ role: 'user', text: chat.pending }} />}

          {chat.streaming && <Bubble message={{ role: 'assistant', text: chat.streaming }} />}

          {chat.sending && !chat.streaming && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="size-4 animate-pulse" />
              {chat.activity ? (TOOL_ACTIVITY[chat.activity] ?? 'Reading your log') : 'Thinking'}…
            </p>
          )}

          {chat.error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {chat.error}
            </p>
          )}

          <div ref={bottom} />
        </div>

        <form onSubmit={submit} className="sticky bottom-4 flex items-end gap-2">
          <Textarea
            value={draft}
            rows={1}
            placeholder="Ask about a meal or today's training…"
            className="max-h-40 min-h-11 resize-none bg-background"
            disabled={chat.sending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, shift+enter breaks the line — what every chat box does,
              // and what fingers expect before they have thought about it.
              if (event.key === 'Enter' && !event.shiftKey) submit(event)
            }}
          />
          <Button type="submit" size="icon" className="size-11 shrink-0" disabled={chat.sending || !draft.trim()}>
            <ArrowUp className="size-5" />
            <span className="sr-only">Send</span>
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Estimates, not medical advice. Numbers come from your log; the rest is the model.
        </p>
      </div>
    </>
  )
}

function Bubble({ message }: { message: Pick<CoachMessage, 'role' | 'text'> }) {
  const mine = message.role === 'user'
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed sm:max-w-[75%]',
          mine
            ? 'rounded-br-sm bg-primary text-primary-foreground'
            : 'rounded-bl-sm border bg-card text-card-foreground',
        )}
      >
        {message.text}
      </div>
    </div>
  )
}

function Empty({ onPick, disabled }: { onPick: (text: string) => void; disabled: boolean }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-5">
      <p className="text-sm text-muted-foreground">
        It can see your food log, your workouts and your weekly plan. It cannot see anything else,
        and it will not talk about anything else.
      </p>
      <div className="flex flex-wrap gap-2">
        {OPENERS.map((text) => (
          <Button key={text} variant="outline" size="sm" disabled={disabled} onClick={() => onPick(text)}>
            {text}
          </Button>
        ))}
      </div>
    </div>
  )
}
