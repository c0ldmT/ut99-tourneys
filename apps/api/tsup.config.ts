import { defineConfig } from 'tsup';

// Workspace packages are bundled in (from source); npm dependencies stay external.
export default defineConfig({
  entry: ['src/main.ts', 'src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
  noExternal: [/^@tourney\//],
  esbuildOptions(options) {
    options.conditions = ['@tourney/source'];
  },
});
