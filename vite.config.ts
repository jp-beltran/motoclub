import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * `HttpBarRepository` (src/features/bar/infrastructure/http-bar-repository.ts)
 * calls a relative `/api/rpc` on the assumption that the SPA and the API
 * share one origin — true once the Node server serves the built `dist/`
 * (see server/http/router.ts), false under `vite dev`, which otherwise
 * answers every unknown path with its own `index.html`. Without this
 * proxy, `/api/rpc` would get HTML back, `response.json()` would throw,
 * and the operator would see a broken screen with no useful explanation —
 * exactly the failure this proxy exists to prevent.
 *
 * Target port follows `BAR_PORT` (see `.superpowers/sdd/prototipo-bar-ui/
 * backend-contract.md`), defaulting to the same 8787 `server/config.ts`
 * itself defaults to, so `npm run dev` and a plain `node server/dist/
 * server.mjs` agree without either side needing to set anything.
 */
const backendPort = Number(process.env.BAR_PORT ?? 8787)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Matches the backend's own "no network" default (server/config.ts's
    // DEFAULT_HOST) and, just as importantly for local dev, keeps the
    // dev server's own cookie host stable: the session cookie
    // `POST /api/session` sets is scoped by host, not port, so logging in
    // once at http://127.0.0.1:<BAR_PORT> (the real server's login page)
    // and then opening http://127.0.0.1:5173 (this dev server) shares
    // that cookie — logging in at `localhost:<port>` instead would not,
    // since browsers treat "localhost" and "127.0.0.1" as different
    // cookie hosts even though they resolve to the same loopback address.
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    // Month attribution is done with local-time getters (getMonthKey,
    // getCurrentMonth). A local->ISO->local round trip is self-consistent at
    // any offset, so only a non-zero offset tells the local implementation
    // apart from a regression to the UTC getters. Pinned to the product's own
    // timezone so a CI box running in UTC still discriminates.
    env: { TZ: 'America/Sao_Paulo' },
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: './src/test/setup.ts',
  },
})
