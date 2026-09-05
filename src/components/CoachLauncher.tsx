import { Eraser, MessageCircle, Maximize2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { coachAvailable, useClearCoach, useCoachHistory } from '@/api/coach'
import { CoachConversation } from '@/components/CoachConversation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

/**
 * The coach, one tap away from every screen.
 *
 * A panel rather than a link to /coach: the questions worth asking are about the
 * screen you are already on — the meal you are logging, the workout in front of
 * you — and navigating away to ask loses exactly that context.
 *
 * It shares CoachConversation with the page, so a conversation started here is
 * the same conversation, already there when the page opens.
 */
export function CoachLauncher() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const { data: history } = useCoachHistory()
  const clear = useClearCoach()

  // Nothing to launch on the page it launches, and nothing to launch at all
  // without a Supabase project to run the function.
  if (!coachAvailable || pathname === '/coach') return null

  return (
    <>
      <Button
        size="icon"
        aria-label="Ask the coach"
        className="fixed right-5 bottom-5 z-40 size-13 rounded-full shadow-lg"
        onClick={() => setOpen(true)}
      >
        <MessageCircle className="size-6" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/*
          The centred dialog, re-anchored to the right edge as a full-height column.
          tailwind-merge resolves the overrides against the defaults, so the base
          component keeps its focus trap, its Escape handling and its scroll lock.
        */}
        <DialogContent
          className="top-0 right-0 bottom-0 left-auto flex h-svh w-full max-w-md translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-l p-0 sm:max-w-md"
          showCloseButton={false}
        >
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <DialogTitle className="text-base">Coach</DialogTitle>
            <div className="flex items-center gap-1">
              {(history?.length ?? 0) > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  aria-label="Clear the conversation"
                  disabled={clear.isPending}
                  onClick={() =>
                    clear.mutate(undefined, {
                      onSuccess: () => toast('Conversation cleared'),
                      onError: (error) => toast.error(error.message),
                    })
                  }
                >
                  <Eraser className="size-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                aria-label="Open the full page"
                asChild
              >
                <Link to="/coach" onClick={() => setOpen(false)}>
                  <Maximize2 className="size-4" />
                </Link>
              </Button>
            </div>
          </div>

          <CoachConversation variant="panel" />
        </DialogContent>
      </Dialog>
    </>
  )
}
