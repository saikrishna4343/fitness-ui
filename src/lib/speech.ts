/**
 * The timer's voice, on the browser's own speech synthesis.
 *
 * No audio files and no library: the cues are half a dozen short phrases, and a bundled
 * voice would be a download on every page load for something the platform already has.
 *
 * Safari and Chrome on iOS refuse to speak until synthesis has been touched inside a
 * user gesture, so `unlockSpeech()` is called from the Start button — without it the
 * first countdown is silent and every later cue works, which is a maddening bug to hit
 * on a phone halfway through a set.
 */

export const speechSupported: boolean =
  typeof window !== 'undefined' && 'speechSynthesis' in window

function utter(text: string, rate: number): SpeechSynthesisUtterance {
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = rate
  utterance.pitch = 1
  utterance.volume = 1
  return utterance
}

/**
 * Says one cue, dropping anything still queued.
 *
 * Cancelling first is deliberate: cues are time-critical. A voice still finishing
 * "three" when "two" is due would push the whole countdown late and, on a short
 * interval, land "start" after the work had already begun.
 */
export function say(text: string, rate = 1.15): void {
  if (!speechSupported) return
  try {
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utter(text, rate))
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

/** Call inside a click handler before the first real cue. See the note above. */
export function unlockSpeech(): void {
  if (!speechSupported) return
  try {
    // A single space is enough to satisfy the gesture requirement and is inaudible.
    window.speechSynthesis.speak(utter(' ', 1))
  } catch {
    /* nothing to do */
  }
}
