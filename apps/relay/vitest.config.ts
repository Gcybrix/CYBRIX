import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@cybrix/shared-types': fileURLToPath(
        new URL('../../packages/shared-types/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    reporters: 'default',
    // integration tests bind loopback ports and use tiny intervals
    testTimeout: 20000,
    hookTimeout: 20000,
    pool: 'forks',
  },
})
