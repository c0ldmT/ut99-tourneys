import { z } from 'zod';
import { buildSlots, createRng } from '@tourney/bracket';
import {
  AccessEntrySchema,
  assignBots,
  BotSpecSchema,
  botEntrant,
  botTeamName,
  MAX_SUBS,
  settingsProblems,
  TournamentSettingsSchema,
  type AccessEntry,
  type BotSpec,
  type Entrant,
  type NewTournamentEvent,
  type TeamEntrant,
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
  /**
   * Team tournaments (settings.teamSize > 1): the teams, players referenced by user id. The first
   * `teamSize` members start, the rest are substitutes. Every player must be in a team.
   */
  teams: z
    .array(
      z.object({
        name: z.string().min(1).max(32),
        tag: z.string().min(1).max(8).optional(),
        members: z
          .array(z.string().min(1))
          .min(1)
          .max(5 + MAX_SUBS),
        captain: z.string().min(1).optional(),
      }),
    )
    .default([]),
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
  const problems = settingsProblems(file.settings);
  if (problems.length) throw new Error(problems.join('; '));
  const teamMode = file.settings.teamSize > 1;

  let humans: Entrant[];
  let access: AccessEntry[];
  if (teamMode) {
    const teamOf = new Map<string, string>();
    humans = file.teams.map((t, i): TeamEntrant => {
      const id = `t${i + 1}`;
      const members = t.members.map((userId, j) => {
        const p = file.players.find((x) => x.userId === userId);
        if (!p) throw new Error(`team ${t.name}: unknown player ${userId}`);
        if (teamOf.has(userId)) throw new Error(`player ${userId} is in two teams`);
        teamOf.set(userId, id);
        return { userId, displayName: p.displayName, sub: j >= file.settings.teamSize };
      });
      return {
        id,
        kind: 'team',
        displayName: t.name,
        ...(t.tag ? { tag: t.tag } : {}),
        captainUserId: t.captain ?? (members[0] as { userId: string }).userId,
        members,
        bots: [],
      };
    });
    const lonely = file.players.filter((p) => !teamOf.has(p.userId));
    if (lonely.length)
      throw new Error(`players without a team: ${lonely.map((p) => p.userId).join(', ')}`);
    access = [
      ...file.players.map((p) => ({ ...p, entrantId: teamOf.get(p.userId) as string })),
      ...file.spectators,
    ];
  } else {
    humans = file.players.map((p, i) => ({
      id: `p${i + 1}`,
      kind: 'human',
      displayName: p.displayName,
      userId: p.userId,
    }));
    access = [
      ...file.players.map((p, i) => ({ ...p, entrantId: `p${i + 1}` })),
      ...file.spectators,
    ];
  }
  const result: BootstrapResult = { access, botPool: file.botPool, created: false };

  const existing = await store.load(file.tournamentId);
  if (existing.length > 0) return result;

  const rngSeed = file.rngSeed ?? `${file.tournamentId}-${Date.now()}`;
  const rng = createRng(rngSeed);
  const bots: Entrant[] = teamMode
    ? Array.from({ length: file.settings.size }, (_, n): TeamEntrant => ({
        id: `botteam-${n + 1}`,
        kind: 'team',
        displayName: 'Bots',
        members: [],
        bots: [],
      }))
    : file.botPool.map((b) => botEntrant(b));
  const slots = buildSlots({
    size: file.settings.size,
    humans: humans.map((h) => h.id),
    botPool: bots.map((b) => b.id),
    humanOrder: file.humanOrder,
    botPlacement: file.settings.botPlacement,
    rng,
  });
  const used = new Set(slots);
  let entrants = [...humans, ...bots].filter((e) => used.has(e.id));
  if (teamMode) {
    // Same as the website: bots for empty starter places, classic names for bot-only teams.
    const ordered = slots.map((id) => entrants.find((e) => e.id === id) as TeamEntrant);
    const fills = assignBots(
      ordered.map((t) => Math.max(0, file.settings.teamSize - t.members.length)),
      file.botPool,
      rng,
    );
    let n = 0;
    entrants = ordered.map((t, i) => ({
      ...t,
      ...(t.members.length ? {} : { displayName: botTeamName(n++) }),
      bots: fills[i] ?? [],
    }));
  }
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
