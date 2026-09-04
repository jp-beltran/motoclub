import { defineConfig, devices } from '@playwright/test'
import { randomBytes, scryptSync } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { E2E_PIN } from './e2e/test-utils'

const PORT = 4173

/**
 * `scrypt$<salt-hex>$<hash-hex>`, matching `server/http/session.ts`'s
 * `hashPin` exactly (16-byte salt, 64-byte derived key) — reimplemented
 * here rather than imported so this config's own TypeScript project
 * (`tsconfig.node.json`, no server-side `lib`) never has to resolve
 * `server/`'s module graph just to boot the test server. The format
 * itself is fixed by the shared backend contract
 * (`.superpowers/sdd/prototipo-bar-ui/backend-contract.md`).
 */
function hashPinForE2e(pin: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(pin, salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

/**
 * A private temp SQLite file per `npx playwright test` invocation. See the
 * `fullyParallel: false` note below for why "shared" is now load-bearing
 * instead of "one per browser context, free."
 */
const dbDir = mkdtempSync(join(tmpdir(), 'motoclub-e2e-'))

export default defineConfig({
  testDir: './e2e',
  // Each browser context used to have its own localStorage, so the 7 spec
  // files were isolated from each other for free. Now every spec talks to
  // the same Node server, backed by the same SQLite file (see
  // webServer.env.BAR_DB_PATH below), so running them concurrently would
  // let one spec's resetDemo/mutations race another spec's assertions —
  // intermittent failures that look like real app bugs and are not.
  // workers: 1 + fullyParallel: false cost a minute or two of wall clock
  // and remove the whole class of flake.
  fullyParallel: false,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Builds the front (dist/) and the server bundle
    // (server/dist/server.mjs), then runs the real Node server — the same
    // artifact the notebook runs in production — instead of `vite
    // preview`, so this suite exercises the actual HTTP/RPC/session
    // surface the client now talks to, not a static file server.
    command: 'npm run build && npm run build:server && node server/dist/server.mjs',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      BAR_DB_PATH: join(dbDir, 'bar.sqlite3'),
      BAR_PIN_HASH: hashPinForE2e(E2E_PIN),
      BAR_SESSION_SECRET: randomBytes(32).toString('hex'),
      BAR_PORT: String(PORT),
      BAR_HOST: '127.0.0.1',
      TZ: 'America/Sao_Paulo',
    },
  },
})
