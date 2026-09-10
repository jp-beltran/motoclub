import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import { TUTORIAL_STEPS } from './tutorial-steps'
import { hasSeenTutorial, markTutorialSeen } from './tutorial-seen'

export interface TutorialController {
  readonly isOpen: boolean
  /** Zero-based index into `TUTORIAL_STEPS`. */
  readonly stepIndex: number
  /** Opens the tour from the beginning, however many times it is asked. */
  readonly open: () => void
  /** Closes the tour and remembers it as seen. */
  readonly close: () => void
  readonly goToNext: () => void
  readonly goToPrevious: () => void
}

const TutorialContext = createContext<TutorialController | undefined>(undefined)

interface TutorialProviderProps {
  readonly children: ReactNode
}

/**
 * Holds the tour's state above the router, because the button that opens it
 * lives in the TopBar and the balloon that shows it lives further down in
 * the shell.
 *
 * The tour opens itself on a browser that has never seen it: the operator
 * who most needs the explanation is exactly the one who would not think to
 * look for a Tutorial button.
 */
export function TutorialProvider({ children }: TutorialProviderProps) {
  const [isOpen, setIsOpen] = useState(() => !hasSeenTutorial())
  const [stepIndex, setStepIndex] = useState(0)

  const close = useCallback(() => {
    setIsOpen(false)
    markTutorialSeen()
  }, [])

  const open = useCallback(() => {
    setStepIndex(0)
    setIsOpen(true)
  }, [])

  /**
   * Reads `stepIndex` from the closure rather than from an updater
   * callback: past the last step there is nothing left to say, so "Próximo"
   * finishes the tour, and closing is a second state change that has no
   * business running inside another one's updater.
   */
  const goToNext = useCallback(() => {
    if (stepIndex >= TUTORIAL_STEPS.length - 1) {
      close()
      return
    }
    setStepIndex(stepIndex + 1)
  }, [stepIndex, close])

  const goToPrevious = useCallback(() => {
    setStepIndex((current) => Math.max(0, current - 1))
  }, [])

  const controller = useMemo<TutorialController>(
    () => ({ isOpen, stepIndex, open, close, goToNext, goToPrevious }),
    [isOpen, stepIndex, open, close, goToNext, goToPrevious],
  )

  return <TutorialContext.Provider value={controller}>{children}</TutorialContext.Provider>
}

export function useTutorial(): TutorialController {
  const controller = useContext(TutorialContext)
  if (!controller) {
    throw new Error('useTutorial must be used within a TutorialProvider')
  }
  return controller
}
