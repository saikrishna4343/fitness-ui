import { Eraser } from 'lucide-react'
import { toast } from 'sonner'
import { coachAvailable, useClearCoach, useCoachHistory } from '@/api/coach'
import { PageHeader } from '@/components/AppShell'
import { CoachConversation } from '@/components/CoachConversation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default function Coach() {
  const { data: history } = useCoachHistory()
  const clear = useClearCoach()

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

      <CoachConversation />
    </>
  )
}
