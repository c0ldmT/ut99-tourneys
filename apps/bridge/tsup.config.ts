import { defineConfig } from 'tsup';

// Workspace packages are bundled in, so dist/ runs standalone on the game server (e.g. the Pi).
export default defineConfig({
  entry: ['src/cli.ts', 'src/sim-cli.ts', 'src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: { entry: 'src/index.ts' },
  clean: true,
  sourcemap: true,
  noExternal: [/^@tourney\//],
  // Bundle the workspace packages from source, never from a possibly stale dist/.
  esbuildOptions(options) {
    options.conditions = ['@tourney/source'];
  },
  banner: { js: '#!/usr/bin/env node' },
});
