import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { TutorialBalloon } from './TutorialBalloon'
import { useTutorial } from './tutorial-context'
import { TUTORIAL_STEPS } from './tutorial-steps'

/**
 * Shows the current step of the tour, and takes the operator to the screen
 * that step is about. Mounted once, inside the shell.
 */
export function TutorialTour() {
  const { isOpen, stepIndex, close, goToNext, goToPrevious } = useTutorial()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const step = TUTORIAL_STEPS[stepIndex]

  /**
   * Advancing to a step about another screen navigates there: without this
   * the balloon would explain Lançamentos while the operator is still
   * looking at the painel, and would have to guess which menu item was
   * meant. Steps with no route of their own (the closing one) are true
   * everywhere and leave the operator where they are.
   */
  useEffect(() => {
    if (!isOpen) return
    if (step.route && step.route !== pathname) {
      navigate(step.route)
    }
  }, [isOpen, step, pathname, navigate])

  if (!isOpen) return null

  return (
    <TutorialBalloon
      step={step}
      stepNumber={stepIndex + 1}
      stepCount={TUTORIAL_STEPS.length}
      onClose={close}
      onNext={goToNext}
      onPrevious={goToPrevious}
    />
  )
}
