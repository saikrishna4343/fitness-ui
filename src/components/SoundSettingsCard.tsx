import { Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  primeAudio,
  say,
  speechSupported,
  tone,
  type BeepLevel,
  type SoundSettings,
} from '@/lib/speech'
import { useVoices } from '@/lib/useVoices'

const AUTO = 'auto'

const SPEEDS = [
  { value: '0.8', label: 'Slow' },
  { value: '0.95', label: 'Normal' },
  { value: '1.15', label: 'Quick' },
]

const BEEPS: { value: BeepLevel; label: string }[] = [
  { value: 'loud', label: 'Loud' },
  { value: 'normal', label: 'Soft' },
  { value: 'off', label: 'Off' },
]

/** Trims the platform's own noise off a voice name: "Microsoft Aria Online (Natural)". */
function voiceLabel(voice: SpeechSynthesisVoice): string {
  const name = voice.name.replace(/\s*\((?:natural|enhanced|premium)\)/i, '').trim()
  return `${name} · ${voice.lang}`
}

export function SoundSettingsCard({
  settings,
  onChange,
}: {
  settings: SoundSettings
  onChange: (settings: SoundSettings) => void
}) {
  const voices = useVoices()

  function test() {
    primeAudio()
    tone('work', settings.beeps)
    // Behind the tone, the way it lands in a real session — a cue that sounds fine on
    // its own can still be buried by the beep it follows.
    window.setTimeout(() => say('Three, two, one. Start. Squats.', settings), 200)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <h2 className="text-base font-semibold">Voice and sound</h2>
        <p className="text-sm text-muted-foreground">
          A beep lands on the beat and the voice follows it. Voices come from your
          browser, so the list differs between your phone and this machine.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="voice" className="text-xs font-normal text-muted-foreground">
              Voice
            </Label>
            <Select
              value={settings.voiceURI ?? AUTO}
              onValueChange={(value) =>
                onChange({ ...settings, voiceURI: value === AUTO ? null : value })
              }
            >
              <SelectTrigger id="voice" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>Best available</SelectItem>
                {voices.map((voice) => (
                  <SelectItem key={voice.voiceURI} value={voice.voiceURI}>
                    {voiceLabel(voice)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="speed" className="text-xs font-normal text-muted-foreground">
              Speed
            </Label>
            <Select
              value={String(settings.rate)}
              onValueChange={(value) => onChange({ ...settings, rate: Number(value) })}
            >
              <SelectTrigger id="speed" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPEEDS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="beeps" className="text-xs font-normal text-muted-foreground">
              Beeps
            </Label>
            <Select
              value={settings.beeps}
              onValueChange={(value) => onChange({ ...settings, beeps: value as BeepLevel })}
            >
              <SelectTrigger id="beeps" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BEEPS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" className="gap-2" onClick={test}>
            <Volume2 className="size-4" />
            Test
          </Button>
          <p className="text-xs text-muted-foreground">
            {speechSupported
              ? 'The voice plays at your device volume — the beeps are the part that carries.'
              : 'This browser has no speech synthesis, so only the beeps will play.'}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
