import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppRouter } from '../../app/AppRouter'
import { BarTestProviders } from '../../test/bar-test-providers'
import { createFakeBarRepository } from '../../test/fake-bar-repository'
import { createBarQueryClient, renderWithBar } from '../../test/render-with-bar'
import { placeBalloon } from './balloon-placement'
import { TutorialTour } from './TutorialTour'
import { TUTORIAL_STEPS } from './tutorial-steps'
import { markTutorialSeen } from './tutorial-seen'

const FIRST_STEP = TUTORIAL_STEPS[0]
const LAST_STEP = TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1]

beforeEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

/**
 * The tour on its own, with no screen behind it — which also means none of
 * the `data-tutorial` anchors exist, so this is the "target not in the DOM"
 * case the balloon has to survive.
 */
function renderTour(options: { readonly seen?: boolean } = {}) {
  return renderWithBar(<TutorialTour />, { tutorialSeen: options.seen ?? false })
}

/** The whole shell: real TopBar button, real routes, real anchors. */
function renderApp(options: { readonly seen?: boolean; readonly route?: string } = {}) {
  return renderWithBar(<AppRouter />, {
    tutorialSeen: options.seen ?? false,
    route: options.route ?? '/',
  })
}

/**
 * A fresh mount that reads whatever is really in `localStorage`, bypassing
 * `renderWithBar`'s `tutorialSeen` option — which writes the flag and would
 * therefore answer the question these tests are asking.
 */
function remountTourWithStoredPreference() {
  return render(
    <BarTestProviders
      repository={createFakeBarRepository()}
      queryClient={createBarQueryClient()}
    >
      <TutorialTour />
    </BarTestProviders>,
  )
}

function balloon() {
  return screen.getByRole('dialog')
}

describe('TutorialTour first visit', () => {
  it('opens by itself the first time the app is used in this browser', async () => {
    renderTour()

    expect(await screen.findByRole('dialog')).toHaveTextContent(FIRST_STEP.title)
  })

  it('stays closed on the next visit, once the tutorial was seen', () => {
    markTutorialSeen()

    renderTour({ seen: true })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  /**
   * A step whose target element is nowhere on screen must still be readable
   * — the balloon centres itself instead of pointing at nothing.
   */
  it('renders a step whose target is not in the DOM', () => {
    renderTour()

    expect(within(balloon()).getByText(FIRST_STEP.body)).toBeInTheDocument()
  })

  it('says where the operator is in the tour', () => {
    renderTour()

    expect(balloon()).toHaveTextContent(`Passo 1 de ${TUTORIAL_STEPS.length}`)
  })

  /**
   * The screen a step points at is normally not mounted yet when the step
   * changes: the shell renders a route's content only once the snapshot has
   * loaded, and a navigating step gets its new screen a commit after the
   * balloon. Without waiting for the element, the balloon stayed centred
   * with its target sitting visibly beside it.
   */
  it('moves next to its target once that target finally mounts', async () => {
    renderTour()
    const dialog = balloon()
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const centered = placeBalloon({ balloonHeight: 0, viewport })
    const anchored = placeBalloon({
      // jsdom measures every element as a zero-sized rect at the origin.
      target: { top: 0, left: 0, width: 0, height: 0 },
      balloonHeight: 0,
      viewport,
    })
    expect(centered.left).not.toBe(anchored.left)
    expect(dialog.style.left).toBe(`${centered.left}px`)

    const target = document.createElement('div')
    target.setAttribute('data-tutorial', String(FIRST_STEP.target))
    document.body.append(target)

    try {
      await waitFor(() => expect(dialog.style.left).toBe(`${anchored.left}px`))
    } finally {
      target.remove()
    }
  })
})

describe('TutorialTour accessibility', () => {
  it('is a dialog named after the step it is showing', () => {
    renderTour()

    expect(screen.getByRole('dialog', { name: FIRST_STEP.title })).toBeInTheDocument()
  })

  /**
   * Not modal on purpose: the operator can be mid-service, so the tutorial
   * must never take the screen hostage.
   */
  it('does not claim to be modal', () => {
    renderTour()

    expect(balloon()).not.toHaveAttribute('aria-modal', 'true')
  })

  it('gives the closing X an accessible name', () => {
    renderTour()

    expect(within(balloon()).getByRole('button', { name: 'Fechar tutorial' })).toBeInTheDocument()
  })

  it('moves the focus to the balloon when the step changes', async () => {
    const user = userEvent.setup()
    renderTour()

    await user.click(within(balloon()).getByRole('button', { name: 'Próximo' }))

    expect(balloon()).toHaveFocus()
  })

  it('closes with Esc', async () => {
    const user = userEvent.setup()
    renderTour()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('TutorialTour navigation between steps', () => {
  it('walks forward through the steps', async () => {
    const user = userEvent.setup()
    renderTour()

    await user.click(within(balloon()).getByRole('button', { name: 'Próximo' }))

    expect(balloon()).toHaveTextContent(TUTORIAL_STEPS[1].title)
    expect(balloon()).toHaveTextContent(`Passo 2 de ${TUTORIAL_STEPS.length}`)
  })

  it('walks back to the previous step', async () => {
    const user = userEvent.setup()
    renderTour()

    await user.click(within(balloon()).getByRole('button', { name: 'Próximo' }))
    await user.click(within(balloon()).getByRole('button', { name: 'Anterior' }))

    expect(balloon()).toHaveTextContent(FIRST_STEP.title)
  })

  it('stays on the first step when "Anterior" is pressed there', async () => {
    const user = userEvent.setup()
    renderTour()

    await user.click(within(balloon()).getByRole('button', { name: 'Anterior' }))

    expect(balloon()).toHaveTextContent(FIRST_STEP.title)
    expect(balloon()).toHaveTextContent(`Passo 1 de ${TUTORIAL_STEPS.length}`)
  })

  it('ends the tutorial when "Próximo" is pressed on the last step', async () => {
    const user = userEvent.setup()
    renderTour()

    for (let step = 1; step < TUTORIAL_STEPS.length; step += 1) {
      await user.click(within(balloon()).getByRole('button', { name: 'Próximo' }))
    }
    expect(balloon()).toHaveTextContent(LAST_STEP.title)

    await user.click(within(balloon()).getByRole('button', { name: 'Próximo' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('TutorialTour closing', () => {
  it('closes on the X and does not come back on the next mount', async () => {
    const user = userEvent.setup()
    const first = renderTour()

    await user.click(within(balloon()).getByRole('button', { name: 'Fechar tutorial' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    first.unmount()

    remountTourWithStoredPreference()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('remembers the tutorial as seen after ending it with "Próximo" on the last step', async () => {
    const user = userEvent.setup()
    const first = renderTour()

    for (let step = 0; step < TUTORIAL_STEPS.length; step += 1) {
      await user.click(within(balloon()).getByRole('button', { name: 'Próximo' }))
    }
    first.unmount()

    remountTourWithStoredPreference()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('TutorialTour storage failures', () => {
  /**
   * A private window can make the accessor itself throw, on the read and on
   * the write. Neither may take the app down: without a readable
   * preference the operator is simply treated as a first-time visitor.
   */
  it('still works when localStorage throws on read and on write', async () => {
    const user = userEvent.setup()
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    renderTour()

    expect(balloon()).toHaveTextContent(FIRST_STEP.title)
    await user.click(within(balloon()).getByRole('button', { name: 'Fechar tutorial' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('TutorialTour inside the app shell', () => {
  it('reopens from the TopBar button even after the tutorial was seen', async () => {
    const user = userEvent.setup()
    markTutorialSeen()
    renderApp({ seen: true })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Tutorial' }))

    expect(await screen.findByRole('dialog')).toHaveTextContent(FIRST_STEP.title)
  })

  it('reopens as many times as the operator asks', async () => {
    const user = userEvent.setup()
    markTutorialSeen()
    renderApp({ seen: true })

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await user.click(screen.getByRole('button', { name: 'Tutorial' }))
      expect(await screen.findByRole('dialog')).toHaveTextContent(FIRST_STEP.title)
      await user.click(within(balloon()).getByRole('button', { name: 'Fechar tutorial' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
  })

  /**
   * The operator should not have to guess where to click: a step that talks
   * about another screen takes them there.
   */
  it('navigates to the route a step belongs to when advancing', async () => {
    const user = userEvent.setup()
    renderApp()

    expect(await screen.findByRole('heading', { level: 1, name: 'Painel' })).toBeInTheDocument()

    await user.click(within(balloon()).getByRole('button', { name: 'Próximo' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Lançamentos' }),
    ).toBeInTheDocument()
    expect(balloon()).toHaveTextContent(TUTORIAL_STEPS[1].title)
  })

  it('points at the element the step is about when it is on screen', async () => {
    renderApp()

    await screen.findByRole('heading', { level: 1, name: 'Painel' })

    expect(document.querySelector(`[data-tutorial="${FIRST_STEP.target}"]`)).not.toBeNull()
  })
})
