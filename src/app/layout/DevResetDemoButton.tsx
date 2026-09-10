import {
  BAR_ERROR_FALLBACKS,
  describeBarError,
} from '../../features/bar/application/error-messages'
import { useResetDemo } from '../../features/bar/application/queries'
import { Button } from '../../shared/ui/Button'
import type { ButtonVariant } from '../../shared/ui/Button'

/**
 * "Restaurar demonstração", and everything that belongs to it: the hook, the
 * confirmation, the label and the failure message.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * The button wipes the entire bar database and reinstalls the demonstration
 * seed. On the club's notebook that database is the real one — a single
 * SQLite file on the machine, shared by every browser that opens the app
 * (see `server/storage/sqlite-storage.ts` and `BAR_DB_PATH`) — so in
 * production this control sits one click and one confirmation away from
 * destroying the month.
 *
 * Every caller renders it behind `import.meta.env.DEV`, which Vite replaces
 * with the literal `false` in a production build. With the whole feature
 * living here rather than inline, that dead branch is the module's only
 * reference: the import drops, and the label, the confirmation text and the
 * `useResetDemo` call go with it. Hiding it with CSS, or with a runtime `if`
 * around JSX that still ships, would leave the string — and the code — in
 * `dist/`. `npm run build` followed by a grep for the label over
 * `dist/assets/*.js` is what actually proves this, and no test can.
 *
 * `resetDemo` itself stays on the port and on the server: the e2e suite
 * restores the seed through `POST /api/rpc { method: 'resetDemo' }` before
 * every test (`e2e/test-utils.ts`), and the repository still installs the
 * seed for a database that does not exist yet. What is gone in production is
 * the button, not the method.
 *
 * The confirmation says what actually happens. The old text promised to
 * replace "os dados salvos neste navegador", which was wrong twice over: the
 * data is not in the browser, and it is not private to whoever clicks.
 */
const RESET_DEMO_CONFIRM_MESSAGE =
  'Restaurar os dados de demonstração? Isso apaga TODOS os dados do bar no ' +
  'servidor — lançamentos, comandas e pagamentos — e reinstala a demonstração. ' +
  'Não há como desfazer.'

export interface DevResetDemoButtonProps {
  readonly variant?: ButtonVariant
}

export function DevResetDemoButton({ variant = 'ghost' }: DevResetDemoButtonProps) {
  const resetDemo = useResetDemo()

  /**
   * Restoring the demo is the app's only way back from broken persisted
   * state, so a failure has to say so: the button re-enables itself the
   * moment the mutation settles, and without this the operator would be left
   * clicking a control that silently does nothing.
   */
  function handleResetDemo() {
    if (window.confirm(RESET_DEMO_CONFIRM_MESSAGE)) {
      resetDemo.reset()
      resetDemo.mutate()
    }
  }

  return (
    <>
      <Button variant={variant} onClick={handleResetDemo} disabled={resetDemo.isPending}>
        Restaurar demonstração
      </Button>
      {resetDemo.isError ? (
        <p role="alert" className="w-full text-right text-sm font-medium text-accent">
          {describeBarError(resetDemo.error, BAR_ERROR_FALLBACKS.resetDemo)}
        </p>
      ) : null}
    </>
  )
}
