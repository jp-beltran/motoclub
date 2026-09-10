/**
 * The `localStorage` entry that records "this browser already saw the
 * tutorial". Deliberately in its own module, with no `window` in sight:
 * `e2e/test-utils.ts` needs these two values, and everything reachable from
 * `playwright.config.ts` is compiled by `tsconfig.node.json`, whose `lib`
 * is `["ES2023"]` with no DOM at all. Importing them from `tutorial-seen.ts`
 * instead drags `window.localStorage` into that DOM-free project and breaks
 * `npm run build`.
 *
 * The alternative — repeating the literals in the e2e helper — is the
 * drift hazard `playwright.config.ts` already carries for its scrypt
 * format, and one such hazard is enough.
 */

/**
 * "Already saw the tutorial" is an interface preference of one browser, not
 * data about the bar, so it never reaches the database: restoring the demo,
 * moving to another notebook or opening the app from a phone should not
 * carry it along, and nothing about the money depends on it.
 */
export const TUTORIAL_SEEN_KEY = 'motoclub:tutorial-visto'

/**
 * Written and compared literally rather than treating "any value present"
 * as seen, so a leftover key from some other tool cannot silently suppress
 * the tutorial on a first visit.
 */
export const TUTORIAL_SEEN_VALUE = 'sim'
