import { afterEach, describe, expect, it, vi } from 'vitest'

import { TUTORIAL_SEEN_KEY, hasSeenTutorial, markTutorialSeen } from './tutorial-seen'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('tutorial seen preference', () => {
  it('treats a browser with nothing stored as never having seen the tutorial', () => {
    expect(hasSeenTutorial()).toBe(false)
  })

  it('remembers the tutorial as seen once it is marked', () => {
    markTutorialSeen()

    expect(hasSeenTutorial()).toBe(true)
  })

  it('stores the preference under the agreed key', () => {
    markTutorialSeen()

    expect(window.localStorage.getItem(TUTORIAL_SEEN_KEY)).not.toBeNull()
  })

  it('ignores a stored value it did not write', () => {
    window.localStorage.setItem(TUTORIAL_SEEN_KEY, 'talvez')

    expect(hasSeenTutorial()).toBe(false)
  })

  /**
   * A private window can make the accessor itself throw. Losing the
   * preference is acceptable; crashing the whole app over it is not.
   */
  it('reports "never seen" instead of throwing when reading is denied', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    expect(() => hasSeenTutorial()).not.toThrow()
    expect(hasSeenTutorial()).toBe(false)
  })

  it('stays silent instead of throwing when writing is denied', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(() => markTutorialSeen()).not.toThrow()
  })
})
