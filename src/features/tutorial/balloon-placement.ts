/** Smallest gap kept between the balloon and any screen edge. */
export const BALLOON_MARGIN = 16

/** Breathing room between the balloon and the element it points at. */
export const BALLOON_GAP = 12

/** Comfortable reading width; the balloon shrinks below it on small screens. */
export const BALLOON_MAX_WIDTH = 360

/** The part of a `DOMRect` the placement actually needs. */
export interface TargetRect {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

export interface Viewport {
  readonly width: number
  readonly height: number
}

export interface BalloonPlacement {
  readonly top: number
  readonly left: number
  readonly width: number
  /** True when there was no target and the balloon fell back to the centre. */
  readonly isCentered: boolean
}

export interface PlaceBalloonInput {
  /** Absent whenever the step has no target, or its element is not mounted. */
  readonly target?: TargetRect
  readonly balloonHeight: number
  readonly viewport: Viewport
}

function clamp(value: number, min: number, max: number): number {
  // `max` first, so a viewport too small for both margins still yields `min`
  // rather than a negative coordinate that would push the balloon off-screen.
  return Math.max(min, Math.min(value, max))
}

/**
 * Where to put the balloon, in viewport coordinates (it is rendered
 * `fixed`). Pure on purpose: the geometry is the part worth testing, and
 * jsdom reports every element as a zero-sized rect, so measuring in a
 * component test would prove nothing.
 *
 * A step whose target is missing gets a centred balloon instead of one
 * pinned to the origin — the operator sees the explanation either way, and
 * the tutorial never appears to point at empty space.
 */
export function placeBalloon({
  target,
  balloonHeight,
  viewport,
}: PlaceBalloonInput): BalloonPlacement {
  const width = Math.min(BALLOON_MAX_WIDTH, viewport.width - BALLOON_MARGIN * 2)
  const maxLeft = viewport.width - width - BALLOON_MARGIN
  const maxTop = viewport.height - balloonHeight - BALLOON_MARGIN

  if (!target) {
    return {
      top: clamp((viewport.height - balloonHeight) / 2, BALLOON_MARGIN, maxTop),
      left: clamp((viewport.width - width) / 2, BALLOON_MARGIN, maxLeft),
      width,
      isCentered: true,
    }
  }

  const below = target.top + target.height + BALLOON_GAP
  const above = target.top - BALLOON_GAP - balloonHeight
  const fitsBelow = below + balloonHeight <= viewport.height - BALLOON_MARGIN
  const fitsAbove = above >= BALLOON_MARGIN

  return {
    top: clamp(fitsBelow || !fitsAbove ? below : above, BALLOON_MARGIN, maxTop),
    left: clamp(target.left, BALLOON_MARGIN, maxLeft),
    width,
    isCentered: false,
  }
}
