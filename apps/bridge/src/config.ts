import fs from 'node:fs';
import { z } from 'zod';

export const BridgeConfigSchema = z.object({
  agentId: z.string().min(1).default('local-agent'),
  mod: z.object({
    host: z.string().default('127.0.0.1'),
    port: z.number().int().min(1).max(65535).default(7790),
    /** Must match SharedKey in the [UTTourney_v1.TournamentConfig] section of the server ini. */
    sharedKey: z.string().min(8),
  }),
  /** Event logs and other state. */
  dataDir: z.string().default('./data'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});
export type BridgeConfig = z.infer<typeof BridgeConfigSchema>;

export function readJsonFile<T>(file: string, schema: z.ZodType<T>): T {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read ${file}: ${(e as Error).message}`, { cause: e });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`invalid ${file}:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export const EXAMPLE_CONFIG = {
  agentId: 'pi-bridge',
  mod: { host: '127.0.0.1', port: 7790, sharedKey: 'change-me-please' },
  dataDir: './data',
  logLevel: 'info',
};

export const EXAMPLE_TOURNAMENT = {
  tournamentId: 'friday-cup',
  name: 'Friday Cup',
  settings: {
    format: 'double',
    size: 8,
    bestOf: { default: 1, grandFinal: 3 },
    botMatchMode: 'watch',
    game: {
      adapter: 'ut99-dm',
      rules: {
        fragLimit: 20,
        timeLimitMin: 10,
        mapMode: 'vote',
        mapPool: [
          'DM-Deck16][',
          'DM-Morpheus',
          'DM-Phobos',
          'DM-Codex',
          'DM-Pressure',
          'DM-Curse][',
        ],
      },
    },
  },
  players: [
    { userId: 'mario', displayName: 'Mario', token: 'mario-token-1' },
    { userId: 'anna', displayName: 'Anna', token: 'anna-token-22' },
  ],
  spectators: [{ userId: 'guest', displayName: 'Guest', token: 'guest-token-3' }],
  botPool: [
    { name: 'Xan', skill: 6 },
    { name: 'Loque', skill: 5 },
    { name: 'Malcolm', skill: 5 },
    { name: 'Brock', skill: 4 },
    { name: 'Lauren', skill: 4 },
    { name: 'Visse', skill: 3 },
    { name: 'Tamika', skill: 3 },
    { name: 'Dominator', skill: 2 },
  ],
};
