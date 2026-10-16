import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // Pure-logic tests run in node. Component tests opt in with `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'database/tests/**/*.test.ts', 'scripts/**/*.test.mjs'],
    testTimeout: 30000,
    setupFiles: ['src/test/setup.ts'],
  },
})
