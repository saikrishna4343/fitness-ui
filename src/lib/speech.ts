/**
 * The timer's voice and its cue tones.
 *
 * No audio files and no library: the cues are half a dozen short phrases, and a bundled
 * voice would be a download on every page load for something the platform already has.
 *
 * Two separate outputs, because they solve different problems:
 *
 *   - Speech says what is happening. `SpeechSynthesisUtterance.volume` is capped at 1,
 *     which is as loud as the platform will make it, so the levers that actually help
 *     are picking a better voice and not rushing it.
 *   - Tones cut through. Web Audio has real gain, so a beep can be considerably louder
 *     and sharper than any voice — which is what carries across a room with music on.
 *
 * Safari and Chrome on iOS refuse to speak or play audio until each has been touched
 * inside a user gesture, so `primeAudio()` runs from the Start button. Without it the
 * first cue is silent and every later one works, which is a maddening bug to hit on a
 * phone halfway through a set.
 */

export type BeepLevel = 'off' | 'normal' | 'loud'

export interface SoundSettings {
  /** `voiceURI` of the chosen voice, or null for the best one this device offers. */
  voiceURI: string | null
  rate: number
  beeps: BeepLevel
}

export const defaultSound: SoundSettings = {
  voiceURI: null,
  // A shade under conversational. The cues are single words heard from across a room,
  // and the default 1.15 clipped the front of "start" on several platform voices.
  rate: 0.95,
  beeps: 'loud',
}

export const speechSupported: boolean =
  typeof window !== 'undefined' && 'speechSynthesis' in window

// ------------------------------------------------------------------ voices

const GOOD = /natural|neural|premium|enhanced|siri|google|online/i
const POOR = /espeak|compact|eloquence|novelty|whisper|zarvox|albert|bad news|bells/i
const NAMED = /samantha|daniel|karen|moira|serena|aria|guy|jenny|libby|sonia|ryan|nathan/i

/**
 * How good a voice is likely to sound, without being able to listen to it.
 *
 * The name is all there is to go on: the API exposes no quality field, and the gap
 * between a platform's neural voice and its 1990s formant fallback is the difference
 * between a cue you can follow mid-burpee and one you cannot.
 */
function score(voice: SpeechSynthesisVoice): number {
  let points = 0
  if (GOOD.test(voice.name)) points += 40
  if (NAMED.test(voice.name)) points += 25
  if (POOR.test(voice.name)) points -= 60
  // Server voices are usually the good ones. They also need a connection, which is why
  // this is a nudge rather than a rule.
  if (!voice.localService) points += 10
  if (voice.default) points += 5
  return points
}

/** English first, best-sounding first, everything else after. */
export function rankedVoices(): SpeechSynthesisVoice[] {
  if (!speechSupported) return []
  const preferred = navigator.language?.slice(0, 2).toLowerCase() ?? 'en'

  return window.speechSynthesis.getVoices().slice().sort((a, b) => {
    const aLang = a.lang.slice(0, 2).toLowerCase()
    const bLang = b.lang.slice(0, 2).toLowerCase()
    const rank = (lang: string) => (lang === preferred ? 0 : lang === 'en' ? 1 : 2)
    if (rank(aLang) !== rank(bLang)) return rank(aLang) - rank(bLang)
    if (score(a) !== score(b)) return score(b) - score(a)
    return a.name.localeCompare(b.name)
  })
}

/**
 * Voices arrive asynchronously on Chrome — the first `getVoices()` after a cold load
 * returns an empty array and the list is filled in later.
 */
export function onVoicesChanged(listener: () => void): () => void {
  if (!speechSupported) return () => {}
  window.speechSynthesis.addEventListener('voiceschanged', listener)
  return () => window.speechSynthesis.removeEventListener('voiceschanged', listener)
}

export function resolveVoice(voiceURI: string | null): SpeechSynthesisVoice | null {
  const voices = rankedVoices()
  if (voices.length === 0) return null
  // A saved voice can vanish: a different browser, or a cloud voice while offline.
  // Falling back to the best available beats going silent.
  return voices.find((voice) => voice.voiceURI === voiceURI) ?? voices[0]
}

// ------------------------------------------------------------------ speech

/**
 * Says one cue, dropping anything still queued.
 *
 * Cancelling first is deliberate: cues are time-critical. A voice still finishing
 * "three" when "two" is due would push the whole countdown late and, on a short
 * interval, land "start" after the work had already begun.
 */
export function say(text: string, settings: SoundSettings = defaultSound): void {
  if (!speechSupported) return
  try {
    const utterance = new SpeechSynthesisUtterance(text)
    const voice = resolveVoice(settings.voiceURI)
    if (voice) {
      utterance.voice = voice
      // Some engines fall back to a default voice when the language disagrees.
      utterance.lang = voice.lang
    }
    utterance.rate = settings.rate
    utterance.pitch = 1
    utterance.volume = 1
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  } catch {
    // A speech engine that throws is not a reason to stop the workout.
  }
}

export function stopSpeaking(): void {
  if (!speechSupported) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    /* nothing to do */
  }
}

// ------------------------------------------------------------------ tones

const GAIN: Record<BeepLevel, number> = { off: 0, normal: 0.35, loud: 0.9 }

let context: AudioContext | null = null

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    context ??= new AudioContext()
    return context
  } catch {
    return null
  }
}

/**
 * One note.
 *
 * The envelope matters more than it looks: gain jumped straight to full and cut straight
 * to zero produces a click at both ends, which on a loud beep is the part that hurts.
 */
function note(at: number, freq: number, seconds: number, gain: number) {
  const ctx = audio()
  if (!ctx || gain <= 0) return

  const start = ctx.currentTime + at
  const oscillator = ctx.createOscillator()
  const envelope = ctx.createGain()

  oscillator.type = 'sine'
  oscillator.frequency.value = freq
  envelope.gain.setValueAtTime(0.0001, start)
  envelope.gain.exponentialRampToValueAtTime(gain, start + 0.012)
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + seconds)

  oscillator.connect(envelope).connect(ctx.destination)
  oscillator.start(start)
  oscillator.stop(start + seconds + 0.02)
}

export type Cue = 'tick' | 'work' | 'rest' | 'finish'

/** The sound that lands on the beat, before the voice explains it. */
export function tone(cue: Cue, level: BeepLevel): void {
  const gain = GAIN[level]
  if (gain <= 0) return

  // Ticks sit under a spoken number, so they stay short and well below it.
  if (cue === 'tick') return note(0, 700, 0.07, gain * 0.45)
  // Going into work: two rising notes, the loudest thing the timer makes.
  if (cue === 'work') {
    note(0, 880, 0.11, gain)
    note(0.13, 1320, 0.16, gain)
    return
  }
  if (cue === 'rest') return note(0, 520, 0.22, gain * 0.8)
  note(0, 660, 0.14, gain)
  note(0.16, 880, 0.14, gain)
  note(0.32, 1100, 0.28, gain)
}

/**
 * Unlocks both outputs. Call inside a click, before the first real cue.
 *
 * An AudioContext constructed outside a gesture starts suspended and stays that way,
 * so every later beep is silently dropped.
 */
export function primeAudio(): void {
  try {
    void audio()?.resume()
  } catch {
    /* nothing to do */
  }
  if (!speechSupported) return
  try {
    // A single space satisfies the gesture requirement and is inaudible.
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(' '))
  } catch {
    /* nothing to do */
  }
}
