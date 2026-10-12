import { z } from 'zod';
import { buildSlots, createRng } from '@tourney/bracket';
import {
  AccessEntrySchema,
  BotSpecSchema,
  botEntrant,
  TournamentSettingsSchema,
  type AccessEntry,
  type BotSpec,
  type Entrant,
  type NewTournamentEvent,
} from '@tourney/protocol';
import { parseRules } from '@tourney/adapter-ut99';
import type { EventStore } from './event-store.js';

/**
 * Standalone mode: a tournament defined in a JSON file instead of the website.
 * Used for local testing and LAN events until the website exists.
 */
const Person = AccessEntrySchema.omit({ entrantId: true });

export const TournamentFileSchema = z.object({
  tournamentId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  name: z.string().min(1).max(100),
  rngSeed: z.string().optional(),
  settings: TournamentSettingsSchema,
  /** Human players. With humanOrder "seeded" the order is the seed order. */
  players: z.array(Person).min(1),
  spectators: z.array(Person).default([]),
  /** Bots that may fill empty slots or replace no-shows. */
  botPool: z.array(BotSpecSchema).min(1),
  humanOrder: z.enum(['random', 'seeded']).default('random'),
  serverProfileId: z.string().default('local'),
});
export type TournamentFile = z.infer<typeof TournamentFileSchema>;

export interface BootstrapResult {
  access: AccessEntry[];
  botPool: BotSpec[];
  created: boolean;
}

export { botEntrant, botEntrantId } from '@tourney/protocol';

export async function bootstrapFromFile(
  store: EventStore,
  file: TournamentFile,
): Promise<BootstrapResult> {
  parseRules(file.settings.game.rules); // fail early on invalid rules

  const humans: Entrant[] = file.players.map((p, i) => ({
    id: `p${i + 1}`,
    kind: 'human',
    displayName: p.displayName,
    userId: p.userId,
  }));
  const access: AccessEntry[] = [
    ...file.players.map((p, i) => ({ ...p, entrantId: `p${i + 1}` })),
    ...file.spectators,
  ];
  const result: BootstrapResult = { access, botPool: file.botPool, created: false };

  const existing = await store.load(file.tournamentId);
  if (existing.length > 0) return result;

  const rngSeed = file.rngSeed ?? `${file.tournamentId}-${Date.now()}`;
  const rng = createRng(rngSeed);
  const bots = file.botPool.map((b) => botEntrant(b));
  const slots = buildSlots({
    size: file.settings.size,
    humans: humans.map((h) => h.id),
    botPool: bots.map((b) => b.id),
    humanOrder: file.humanOrder,
    botPlacement: file.settings.botPlacement,
    rng,
  });
  const used = new Set(slots);
  const entrants = [...humans, ...bots].filter((e) => used.has(e.id));
  const system = { kind: 'system' as const };

  const events: NewTournamentEvent[] = [
    {
      type: 'tournament.created',
      actor: system,
      data: { tournamentId: file.tournamentId, name: file.name, settings: file.settings },
    },
    {
      type: 'seeding.set',
      actor: system,
      data: {
        entrants,
        rngSeed,
        bracket: {
          format: file.settings.format,
          size: file.settings.size,
          slots,
          grandFinalReset: file.settings.grandFinalReset,
          bestOf: file.settings.bestOf,
        },
      },
    },
    { type: 'checkin.opened', actor: system, data: { serverProfileId: file.serverProfileId } },
  ];
  const res = await store.append(file.tournamentId, 0, events);
  if (!res.accepted) throw new Error(`could not create tournament: ${res.reason}`);
  return { ...result, created: true };
}
