import { describe, expect, it } from 'vitest'

import {
  BALLOON_GAP,
  BALLOON_MARGIN,
  BALLOON_MAX_WIDTH,
  placeBalloon,
} from './balloon-placement'

const DESKTOP = { width: 1280, height: 800 }
/** The bar notebook's narrowest supported width. */
const PHONE = { width: 390, height: 844 }

describe('placeBalloon without a target', () => {
  it('centres itself on screen instead of pointing at nothing', () => {
    const placement = placeBalloon({ balloonHeight: 200, viewport: DESKTOP })

    expect(placement.isCentered).toBe(true)
    expect(placement.left).toBe((DESKTOP.width - placement.width) / 2)
    expect(placement.top).toBe((DESKTOP.height - 200) / 2)
  })

  it('stays inside the screen when the balloon is taller than the viewport', () => {
    const placement = placeBalloon({ balloonHeight: 2000, viewport: PHONE })

    expect(placement.top).toBe(BALLOON_MARGIN)
    expect(placement.left).toBeGreaterThanOrEqual(BALLOON_MARGIN)
  })
})

describe('placeBalloon next to a target', () => {
  it('sits just below the target, aligned to its left edge', () => {
    const placement = placeBalloon({
      target: { top: 100, left: 240, width: 300, height: 60 },
      balloonHeight: 180,
      viewport: DESKTOP,
    })

    expect(placement.isCentered).toBe(false)
    expect(placement.top).toBe(100 + 60 + BALLOON_GAP)
    expect(placement.left).toBe(240)
  })

  it('flips above the target when there is no room below', () => {
    const placement = placeBalloon({
      target: { top: 700, left: 100, width: 200, height: 40 },
      balloonHeight: 180,
      viewport: DESKTOP,
    })

    expect(placement.top).toBe(700 - BALLOON_GAP - 180)
  })

  it('keeps the balloon on screen when it fits neither below nor above', () => {
    const placement = placeBalloon({
      target: { top: 300, left: 100, width: 200, height: 40 },
      balloonHeight: 780,
      viewport: DESKTOP,
    })

    expect(placement.top).toBeGreaterThanOrEqual(BALLOON_MARGIN)
    expect(placement.top).toBeLessThanOrEqual(BALLOON_MARGIN)
  })
})

describe('placeBalloon horizontal clamping', () => {
  it('never lets the balloon start before the left margin', () => {
    const placement = placeBalloon({
      target: { top: 10, left: -120, width: 80, height: 40 },
      balloonHeight: 100,
      viewport: DESKTOP,
    })

    expect(placement.left).toBe(BALLOON_MARGIN)
  })

  it('never lets the balloon run past the right margin', () => {
    const placement = placeBalloon({
      target: { top: 10, left: 1260, width: 80, height: 40 },
      balloonHeight: 100,
      viewport: DESKTOP,
    })

    expect(placement.left + placement.width).toBeLessThanOrEqual(
      DESKTOP.width - BALLOON_MARGIN,
    )
  })
})

describe('placeBalloon width', () => {
  it('caps the balloon width on a wide screen', () => {
    const placement = placeBalloon({ balloonHeight: 100, viewport: DESKTOP })

    expect(placement.width).toBe(BALLOON_MAX_WIDTH)
  })

  /**
   * The whole point of the margins: at 390px the balloon has to shrink,
   * because a fixed 360px box pushed to a target's left edge is what would
   * spill off-screen and give the layout a horizontal scrollbar.
   */
  it('shrinks to fit a 390px screen with both margins intact', () => {
    const placement = placeBalloon({
      target: { top: 10, left: 300, width: 80, height: 40 },
      balloonHeight: 100,
      viewport: PHONE,
    })

    expect(placement.width).toBe(PHONE.width - BALLOON_MARGIN * 2)
    expect(placement.left).toBe(BALLOON_MARGIN)
    expect(placement.left + placement.width).toBe(PHONE.width - BALLOON_MARGIN)
  })
})
