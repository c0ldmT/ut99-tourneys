import { z } from 'zod';
import {
  BRACKET_SIZES,
  FIXTURE_SIZES,
  type BestOfPolicy,
  type BracketDefinition,
  type GameResult,
  type MatchResult,
} from '@tourney/bracket';

/** Schemas for the shared tournament domain. They mirror the bracket engine types 1:1. */

export const Id = z.string().min(1).max(64);
export const OddBestOf = z
  .number()
  .int()
  .refine((n) => [1, 3, 5, 7].includes(n), {
    message: 'must be 1, 3, 5 or 7',
  });

export const BestOfPolicySchema = z.object({
  default: OddBestOf,
  semifinal: OddBestOf.optional(),
  final: OddBestOf.optional(),
  lbFinal: OddBestOf.optional(),
  grandFinal: OddBestOf.optional(),
}) satisfies z.ZodType<BestOfPolicy>;

/** "fixtures": independent pairings of a league matchday (sizes 2-16, see FIXTURE_SIZES). */
export const BracketFormatSchema = z.enum(['single', 'double', 'fixtures']);
export const BracketSizeSchema = z.union([
  z.literal(2),
  z.literal(4),
  z.literal(6),
  z.literal(8),
  z.literal(10),
  z.literal(12),
  z.literal(14),
  z.literal(16),
  z.literal(32),
]);

export const BracketDefinitionSchema = z.object({
  format: BracketFormatSchema,
  size: BracketSizeSchema,
  slots: z.array(Id),
  grandFinalReset: z.boolean(),
  bestOf: BestOfPolicySchema,
}) satisfies z.ZodType<BracketDefinition>;

export const GameResultSchema = z.object({
  map: z.string().optional(),
  scores: z.record(z.string(), z.number()),
  winnerId: Id,
}) satisfies z.ZodType<GameResult>;

export const MatchResultSchema = z.object({
  matchId: Id,
  entrants: z.tuple([Id, Id]),
  winnerId: Id,
  outcome: z.enum(['played', 'forfeit', 'simulated', 'override']),
  games: z.array(GameResultSchema).optional(),
}) satisfies z.ZodType<MatchResult>;

/** Bot skill as in UT99: 0 (Novice) .. 7 (Godlike). */
export const BotSkill = z.number().min(0).max(7);

/**
 * How a bot plays (UT99 ChallengeBotInfo values): accuracy, alertness, strafing -1..1 (0 =
 * normal), combat style -1 (avoidant) .. 1 (berserk), camping 0..1, plus favourite weapon and
 * voice (class names).
 */
export const BotTraitsSchema = z.object({
  accuracy: z.number().min(-1).max(1).optional(),
  alertness: z.number().min(-1).max(1).optional(),
  combatStyle: z.number().min(-1).max(1).optional(),
  camping: z.number().min(0).max(1).optional(),
  strafing: z.number().min(-1).max(1).optional(),
  jumpy: z.boolean().optional(),
  favoriteWeapon: z.string().max(64).optional(),
  voice: z.string().max(64).optional(),
});
export type BotTraits = z.infer<typeof BotTraitsSchema>;

export const BotSpecSchema = z.object({
  /**
   * Name in the game (with the clan tag of a website bot). Bots without `id` are looked up by
   * this name in the server's bot configuration.
   */
  name: z.string().min(1).max(32),
  skill: BotSkill,
  /** Website bot library id: statistics and ratings follow it, not the name. */
  id: z.string().min(1).max(40).optional(),
  /** Game-specific class/character, e.g. "BotPack.TMale1Bot" for UT99. */
  botClass: z.string().max(128).optional(),
  skin: z.string().max(128).optional(),
  face: z.string().max(128).optional(),
  traits: BotTraitsSchema.optional(),
  /** Unreal Dream Team: codes of the traits the mod plays (`btrt`, mod 0.9.0). */
  gameTraits: z
    .array(z.string().regex(/^[a-z]{2}$/))
    .max(5)
    .optional(),
  /**
   * Unreal Dream Team, Monster Hunt (mod 0.17.0): the bot's focus set by its manager, -2 hunter
   * (fights every monster) … 2 sprinter (only what is in the way); missing or 0: standard.
   */
  mhFocus: z.number().int().min(-2).max(2).optional(),
});
export type BotSpec = z.infer<typeof BotSpecSchema>;

/** Players per team: 1 = one on one, otherwise team deathmatch (2on2, 3on3, 5on5). */
export const TeamSizeSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5)]);
export type TeamSize = z.infer<typeof TeamSizeSchema>;
/** Substitutes a team may register on top of its starters. */
export const MAX_SUBS = 2;
/** Largest bracket (in teams) for team tournaments. */
export const MAX_TEAM_BRACKET = 16;

export const TeamMemberSchema = z.object({
  userId: Id,
  displayName: z.string().min(1).max(32),
  /** Substitutes play only when a starter is missing (or the captain lines them up). */
  sub: z.boolean(),
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;

/**
 * A bracket position holder. The id never changes; the occupant can (e.g. a bot replacing a
 * no-show at check-in), which is recorded with an `entrant.replaced` event.
 */
export const EntrantSchema = z.discriminatedUnion('kind', [
  z.object({
    id: Id,
    kind: z.literal('human'),
    displayName: z.string().min(1).max(32),
    /** Website user id (linked to a Discord account). */
    userId: Id,
  }),
  z.object({
    id: Id,
    kind: z.literal('bot'),
    displayName: z.string().min(1).max(32),
    bot: BotSpecSchema,
  }),
  z.object({
    id: Id,
    kind: z.literal('team'),
    /** Team name. */
    displayName: z.string().min(1).max(32),
    tag: z.string().min(1).max(8).optional(),
    captainUserId: Id.optional(),
    /** Starters first, then substitutes. Empty for a bot team. */
    members: z.array(TeamMemberSchema).max(5 + MAX_SUBS),
    /** Bots that take the starter places nobody fills, in this order. */
    bots: z.array(BotSpecSchema).max(5),
  }),
]);
export type Entrant = z.infer<typeof EntrantSchema>;

/** Entrant id of a bot, derived from its name (stable, safe for file names and URLs). */
export const botEntrantId = (name: string) => `bot-${name.replace(/[^A-Za-z0-9_-]/g, '_')}`;

/** Entrant id of a bot: its library id, else its name. */
export const botSpecEntrantId = (spec: BotSpec) =>
  spec.id ? botEntrantId(spec.id) : botEntrantId(spec.name);

export function botEntrant(spec: BotSpec, id = botSpecEntrantId(spec)): Entrant {
  return { id, kind: 'bot', displayName: spec.name, bot: spec };
}

export type TeamEntrant = Extract<Entrant, { kind: 'team' }>;

/** Unreal Dream Team: the entrant of a manager's team (bots only, the manager watches). */
export const udtEntrantId = (userId: string) => `udt-${userId}`;
/** The manager of a Dream Team entrant (undefined for other entrants). */
export const udtManagerOf = (entrantId: string): string | undefined =>
  entrantId.startsWith('udt-') ? entrantId.slice(4) : undefined;

/** Starters of a team in lineup order (at most `teamSize`). */
export const teamStarters = (team: TeamEntrant, teamSize: number) =>
  team.members.filter((m) => !m.sub).slice(0, teamSize);

/** A bot, or a team without players (made of bots only). */
export const isBotEntrant = (e: Entrant | undefined): boolean =>
  e?.kind === 'bot' || (e?.kind === 'team' && e.members.length === 0);

/** Website user ids that belong to an entrant (the player, or every team member). */
export function entrantUserIds(e: Entrant): string[] {
  if (e.kind === 'human') return [e.userId];
  if (e.kind === 'team') return e.members.map((m) => m.userId);
  return [];
}

/** Classic UT team names, used for teams made of bots only. */
export const BOT_TEAM_NAMES = [
  'Thunder Crash',
  'Iron Guard',
  'Hellions',
  'Juggernauts',
  'Black Legion',
  'Venom',
  'Blood Reavers',
  'Iron Skull',
  'Bloodfist',
  'Corrupt',
  'Necris Clan',
  'Krall Raiders',
  'Skaarj Hybrids',
  'Nali Avengers',
  'Mercenaries',
  'Rogue Squad',
] as const;

export const botTeamName = (index: number): string =>
  BOT_TEAM_NAMES[index] ?? `Bot Team ${index + 1}`;

/** Entrant id of a website user. */
export const userEntrantId = (userId: string) => `u-${userId}`;

export const ServerOsSchema = z.enum(['linux', 'windows']);
export type ServerOs = z.infer<typeof ServerOsSchema>;

/** Game-independent tournament settings. Game rules live in `game.rules`, validated by the adapter. */
export const TournamentSettingsSchema = z.object({
  format: BracketFormatSchema,
  size: BracketSizeSchema,
  /** 1 = one on one; 2, 3 or 5 = team deathmatch, the bracket then holds teams. */
  teamSize: TeamSizeSchema.default(1),
  grandFinalReset: z.boolean().default(true),
  bestOf: BestOfPolicySchema.default({ default: 1 }),
  /** Minutes players have to connect before missing ones are replaced by bots. */
  checkInWindowMin: z.number().int().min(1).max(120).default(10),
  /** Seconds a match player may be missing at ready check before forfeiting. */
  noShowSec: z.number().int().min(30).max(1800).default(180),
  /** Seconds a match player may be disconnected during a live match before forfeiting. */
  reconnectGraceSec: z.number().int().min(30).max(1800).default(180),
  /** Disconnects a match player may come back from per match; the next one is a forfeit. */
  maxReconnects: z.number().int().min(0).max(10).default(2),
  /** Bot vs bot matches: play them live (spectatable) or simulate the result. */
  botMatchMode: z.enum(['watch', 'simulate']).default('watch'),
  /** How bots fill empty slots when seeding automatically. */
  botPlacement: z.enum(['byes', 'random']).default('byes'),
  /** Team games: clans with enough bots in the pool play as bot teams of their own. */
  clanTeams: z.boolean().default(false),
  /** Seconds the server keeps running after the final (standings on screen), then it is stopped. */
  postTournamentShutdownSec: z.number().int().min(0).max(7200).default(30),
  game: z.object({
    /** Adapter id, e.g. "ut99-dm". */
    adapter: z.string().min(1),
    rules: z.record(z.string(), z.unknown()),
  }),
});
export type TournamentSettings = z.infer<typeof TournamentSettingsSchema>;

/** Cross-field checks the schema cannot express. Returns human-readable problems. */
export function settingsProblems(s: TournamentSettings): string[] {
  const problems: string[] = [];
  const sizes: readonly number[] = s.format === 'fixtures' ? FIXTURE_SIZES : BRACKET_SIZES;
  if (!sizes.includes(s.size)) problems.push(`a ${s.format} bracket cannot hold ${s.size}`);
  if (s.teamSize > 1 && s.size > MAX_TEAM_BRACKET) {
    problems.push(`team tournaments hold at most ${MAX_TEAM_BRACKET} teams`);
  }
  return problems;
}
export type TournamentSettingsInput = z.input<typeof TournamentSettingsSchema>;
