import { useSyncExternalStore } from 'react'
import { onVoicesChanged, rankedVoices } from '@/lib/speech'

const EMPTY: SpeechSynthesisVoice[] = []
let cached: SpeechSynthesisVoice[] = EMPTY

/**
 * The snapshot has to be referentially stable or React re-renders forever, and
 * `getVoices()` hands back a fresh array every call — so the list is only swapped when
 * the voices themselves have actually changed.
 */
function snapshot(): SpeechSynthesisVoice[] {
  const next = rankedVoices()
  const same =
    next.length === cached.length &&
    next.every((voice, index) => voice.voiceURI === cached[index].voiceURI)
  if (!same) cached = next
  return cached
}

/**
 * The voices this device offers, best first.
 *
 * Chrome returns an empty list on a cold load and fills it in a moment later, which is
 * exactly the external store `voiceschanged` was made for.
 */
export function useVoices(): SpeechSynthesisVoice[] {
  return useSyncExternalStore(onVoicesChanged, snapshot, () => EMPTY)
}
