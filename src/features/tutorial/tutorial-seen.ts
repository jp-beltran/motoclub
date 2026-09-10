import { TUTORIAL_SEEN_KEY, TUTORIAL_SEEN_VALUE } from './tutorial-storage'

/**
 * Every access is wrapped because in a private window the accessor itself
 * can throw before we ever read a value — the app must not break over a
 * preference. With nothing readable we answer "never saw it", which at
 * worst shows one extra balloon the operator can close.
 */
export function hasSeenTutorial(): boolean {
  try {
    return window.localStorage.getItem(TUTORIAL_SEEN_KEY) === TUTORIAL_SEEN_VALUE
  } catch {
    return false
  }
}

/**
 * A browser that refuses to store the flag will simply open the tutorial
 * again on the next visit. That is a far smaller cost than letting a
 * storage failure take the screen down mid-service.
 */
export function markTutorialSeen(): void {
  try {
    window.localStorage.setItem(TUTORIAL_SEEN_KEY, TUTORIAL_SEEN_VALUE)
  } catch {
    // Intentionally ignored: see the note above.
  }
}
