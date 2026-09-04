import { defineConfig } from 'vitest/config'

// Separate from the root `vite.config.ts` / `npm run test:run` on purpose:
// this suite runs against real files (`node:sqlite`, temp directories) in a
// Node environment, not jsdom, and must never change the count or the
// command of the 546 existing unit/component tests.
export default defineConfig({
  test: {
    environment: 'node',
    // Mirrors vite.config.ts: getMonthKey/getCurrentMonth attribute by local
    // time, and LocalBarRepository is exercised for real in this suite.
    env: { TZ: 'America/Sao_Paulo' },
    include: ['server/**/*.test.ts'],
  },
})
