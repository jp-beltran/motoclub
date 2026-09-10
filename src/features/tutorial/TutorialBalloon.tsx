import { X } from 'lucide-react'
import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react'

import { Button } from '../../shared/ui/Button'
import { BALLOON_MARGIN, placeBalloon, type BalloonPlacement } from './balloon-placement'
import type { TutorialStep } from './tutorial-steps'

export interface TutorialBalloonProps {
  readonly step: TutorialStep
  /** 1-based, for "Passo 3 de 9". */
  readonly stepNumber: number
  readonly stepCount: number
  readonly onClose: () => void
  readonly onNext: () => void
  readonly onPrevious: () => void
}

/**
 * The balloon's own width is fixed in CSS rather than from the placement, so
 * the element is already the right width when its height is measured — the
 * measurement decides whether the balloon fits below its target, and the
 * height depends on the width. `min()` keeps a 390px screen inside both
 * margins without any JavaScript running at all.
 */
const WIDTH_CLASS = 'w-[min(360px,calc(100vw-2rem))]'

function isSamePlacement(a: BalloonPlacement | undefined, b: BalloonPlacement): boolean {
  return (
    a !== undefined &&
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.isCentered === b.isCentered
  )
}

const CLOSE_BUTTON_CLASSES =
  'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md ' +
  'text-content-muted transition-colors hover:bg-surface-raised hover:text-content-primary ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-accent'

/**
 * One step of the tour, floating next to the element it explains.
 *
 * `role="dialog"` without `aria-modal`: the operator can be halfway through
 * serving someone, so the balloon never blocks the screen behind it. It is
 * `fixed` and above the tab panel's own overlay (z-30) so it stays readable
 * wherever the page is scrolled.
 */
export function TutorialBalloon({
  step,
  stepNumber,
  stepCount,
  onClose,
  onNext,
  onPrevious,
}: TutorialBalloonProps) {
  const balloonRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const bodyId = useId()
  const [placement, setPlacement] = useState<BalloonPlacement>()

  /**
   * A layout effect, so the measured position is applied before the browser
   * paints and the balloon never flashes at its fallback corner. Re-runs
   * per step, and follows resizes and scrolling (capturing, because the
   * scrolled element is usually the page's own container, not the window).
   */
  useLayoutEffect(() => {
    const selector = step.target ? `[data-tutorial="${step.target}"]` : undefined

    /** Places the balloon; answers whether the target was actually there. */
    function place(): boolean {
      const balloon = balloonRef.current
      if (!balloon) return false
      const target = selector ? document.querySelector(selector) : null
      const next = placeBalloon({
        target: target?.getBoundingClientRect(),
        balloonHeight: balloon.getBoundingClientRect().height,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      })
      // Keeping the previous object when nothing moved matters because the
      // observer below can fire on unrelated DOM changes.
      setPlacement((current) => (isSamePlacement(current, next) ? current : next))
      return target !== null
    }

    const found = place()

    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)

    /**
     * The screen a step points at is usually not mounted yet at the moment
     * the step changes: the shell renders a route's content only once the
     * snapshot has loaded, and a step that navigates gets its new screen a
     * commit later than this balloon. Without waiting for the element, the
     * balloon would settle in the middle of the screen and stay there with
     * its target sitting visibly beside it — which is what it did.
     */
    let observer: MutationObserver | undefined
    if (selector && !found) {
      observer = new MutationObserver(() => {
        if (place()) observer?.disconnect()
      })
      observer.observe(document.body, { childList: true, subtree: true })
    }

    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      observer?.disconnect()
    }
  }, [step])

  /** Changing step moves the reader's focus with it. */
  useEffect(() => {
    balloonRef.current?.focus()
  }, [step])

  /**
   * Esc listens on the window rather than on the balloon: nothing here
   * traps focus, so the operator may well have clicked back into the screen
   * behind before deciding to dismiss the tutorial.
   */
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      ref={balloonRef}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      tabIndex={-1}
      style={{
        top: placement?.top ?? BALLOON_MARGIN,
        left: placement?.left ?? BALLOON_MARGIN,
      }}
      className={`fixed z-40 ${WIDTH_CLASS} rounded-lg border border-accent bg-surface-overlay p-4 shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id={titleId} className="text-base font-semibold text-content-primary">
          {step.title}
        </h2>
        <button type="button" onClick={onClose} className={CLOSE_BUTTON_CLASSES}>
          <X aria-hidden="true" className="h-5 w-5" />
          <span className="sr-only">Fechar tutorial</span>
        </button>
      </div>

      <p id={bodyId} className="mt-1 text-sm text-content-muted">
        {step.body}
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-medium text-content-muted">
          {`Passo ${stepNumber} de ${stepCount}`}
        </p>
        <div className="flex gap-2">
          {/* Desabilitado no primeiro passo em vez de só não fazer nada: um
              botão que parece clicável e ignora o toque é o oposto do que
              este app promete em toda tela. */}
          <Button
            variant="ghost"
            className="px-3"
            onClick={onPrevious}
            disabled={stepNumber === 1}
          >
            Anterior
          </Button>
          {/* No último passo este botão ENCERRA o tutorial, então ele diz
              isso. Rotular de "Próximo" algo que fecha a janela faz o
              operador achar que perdeu um passo. */}
          <Button variant="primary" className="px-3" onClick={onNext}>
            {stepNumber === stepCount ? 'Concluir' : 'Próximo'}
          </Button>
        </div>
      </div>
    </div>
  )
}
