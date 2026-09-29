import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * `npm run verify` runs the lessons' scenarios against real nginx, HAProxy and
 * Redis (see verify/README.md). Tests run one file at a time because several
 * of them measure timing.
 */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['verify/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 60_000,
    globalSetup: ['verify/lib/global.ts'],
  },
});
