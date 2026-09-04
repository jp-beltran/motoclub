import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
