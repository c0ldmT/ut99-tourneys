import { defineConfig } from 'vitest/config';

/** Resolve workspace packages to their TypeScript sources so tests never depend on a prior build. */
export default defineConfig({
  resolve: { conditions: ['@tourney/source'] },
  ssr: { resolve: { conditions: ['@tourney/source'] } },
  test: { include: ['test/**/*.test.ts'] },
});
