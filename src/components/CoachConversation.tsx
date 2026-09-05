import { ArrowUp, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useCoachChat, useCoachHistory } from '@/api/coach'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { TOOL_ACTIVITY, type CoachMessage } from '@/types/coach'

const OPENERS = [
  'How many calories should I eat today?',
  'What should I train today?',
  'How did last week look?',
]

/**
 * The conversation itself, shared by the Coach page and the slide-over panel.
 *
 * One component rather than two: the panel exists so you can ask about the screen
 * you are already on, and a second copy of a streaming chat would be a second
 * place for the scroll behaviour and the send guard to drift.
 *
 * The two differ only in who scrolls. On the page the window does; in the panel
 * the message list has to, because the panel is a fixed-height column.
 */
export function CoachConversation({ variant = 'page' }: { variant?: 'page' | 'panel' }) {
  const [draft, setDraft] = useState('')
  const { data: history, isLoading } = useCoachHistory()
  const chat = useCoachChat()
  const bottom = useRef<HTMLDivElement>(null)
  const panel = variant === 'panel'

  // Follows the answer as it streams. Not smooth: a smooth scroll cannot keep up
  // with tokens arriving, and trails a line or two behind for the whole reply.
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

  const empty = !isLoading && (history?.length ?? 0) === 0 && !chat.pending

  return (
    <div className={cn('flex flex-col gap-4', panel && 'h-full min-h-0')}>
      <div
        className={cn(
          'flex flex-col gap-4',
          panel ? 'min-h-0 flex-1 overflow-y-auto px-4 pt-4' : 'min-h-[52svh]',
        )}
      >
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

      <div className={cn('flex flex-col gap-2', panel ? 'border-t bg-background px-4 py-3' : 'sticky bottom-4')}>
        <form onSubmit={submit} className="flex items-end gap-2">
          <Textarea
            value={draft}
            rows={1}
            placeholder="Ask about a meal or today's training…"
            className="max-h-40 min-h-11 resize-none bg-background"
            disabled={chat.sending}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, shift+enter breaks the line — what fingers expect
              // before they have thought about it.
              if (event.key === 'Enter' && !event.shiftKey) submit(event)
            }}
          />
          <Button
            type="submit"
            size="icon"
            className="size-11 shrink-0"
            disabled={chat.sending || !draft.trim()}
          >
            <ArrowUp className="size-5" />
            <span className="sr-only">Send</span>
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Estimates, not medical advice. Numbers come from your log; the rest is the model.
        </p>
      </div>
    </div>
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
          <Button
            key={text}
            variant="outline"
            size="sm"
            className="h-auto whitespace-normal text-left"
            disabled={disabled}
            onClick={() => onPick(text)}
          >
            {text}
          </Button>
        ))}
      </div>
    </div>
  )
}
