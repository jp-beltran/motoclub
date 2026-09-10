/**
 * "Already saw the tutorial" is an interface preference of one browser, not
 * data about the bar, so it lives in `localStorage` and never reaches the
 * database: restoring the demo, moving to another notebook or opening the
 * app from a phone should not carry it along, and nothing about the money
 * depends on it.
 */
export const TUTORIAL_SEEN_KEY = 'motoclub:tutorial-visto'

/**
 * Written and compared literally rather than treating "any value present"
 * as seen, so a leftover key from some other tool cannot silently suppress
 * the tutorial on a first visit.
 */
const SEEN_VALUE = 'sim'

/**
 * Every access is wrapped because in a private window the accessor itself
 * can throw before we ever read a value — the app must not break over a
 * preference. With nothing readable we answer "never saw it", which at
 * worst shows one extra balloon the operator can close.
 */
export function hasSeenTutorial(): boolean {
  try {
    return window.localStorage.getItem(TUTORIAL_SEEN_KEY) === SEEN_VALUE
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
    window.localStorage.setItem(TUTORIAL_SEEN_KEY, SEEN_VALUE)
  } catch {
    // Intentionally ignored: see the note above.
  }
}
