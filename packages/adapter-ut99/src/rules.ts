import { z } from 'zod';

export const ADAPTER_ID = 'ut99-dm';

/**
 * UnrealScript package name of the mod. UT99 requires a new package name for every
 * network-incompatible release (clients cache packages by name), so this changes with the mod.
 */
export const MOD_PACKAGE = 'UTTourney_v1';
export const MOD_GAME_CLASS = `${MOD_PACKAGE}.TournamentDM`;

/** Match rules for 1v1 Deathmatch, editable per tournament on the website. */
export const Ut99DmRulesSchema = z
  .object({
    /** 0 = no frag limit. */
    fragLimit: z.number().int().min(0).max(200).default(20),
    /**
     * Minutes, 0 = no time limit. Frag limit and time limit cannot both be 0.
     * A tie at the time limit always goes to sudden death (UT overtime: next frag wins).
     */
    timeLimitMin: z.number().int().min(0).max(60).default(10),

    mapMode: z.enum(['random', 'vote']).default('vote'),
    /** Map ids (package names) available for this tournament. Validated against the server inventory. */
    mapPool: z.array(z.string().min(1).max(64)).min(1),
    /** How many ranked picks each player gets in a vote. */
    picksPerPlayer: z.number().int().min(1).max(3).default(3),
    voteTimeoutSec: z.number().int().min(10).max(120).default(45),
    /** Maps played in the last N games of the tournament get a penalty / are avoided in random mode. */
    avoidRecentMaps: z.number().int().min(0).max(10).default(3),

    countdownSec: z.number().int().min(3).max(30).default(5),

    // Server-wide game settings (applied via ini at server start).
    weaponStay: z.boolean().default(true),
    hardcore: z.boolean().default(true),
    /** Game speed in percent, 100 = normal. */
    gameSpeedPct: z.number().int().min(50).max(200).default(100),
    /** Mutator classes, e.g. "BotPack.InstaGibDM". Must exist on the server. */
    mutators: z
      .array(z.string().regex(/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/))
      .max(8)
      .default([]),
  })
  .refine((r) => r.fragLimit > 0 || r.timeLimitMin > 0, {
    message: 'frag limit and time limit cannot both be 0',
    path: ['fragLimit'],
  });

export type Ut99DmRules = z.infer<typeof Ut99DmRulesSchema>;
export type Ut99DmRulesInput = z.input<typeof Ut99DmRulesSchema>;

export function parseRules(input: unknown): Ut99DmRules {
  return Ut99DmRulesSchema.parse(input);
}

/** Checks rules against what the server actually has installed. Returns human-readable problems. */
export function validateAgainstInventory(
  rules: Ut99DmRules,
  inventory: { maps: readonly { id: string }[] },
): string[] {
  const available = new Set(inventory.maps.map((m) => m.id.toLowerCase()));
  return rules.mapPool
    .filter((m) => !available.has(m.toLowerCase()))
    .map((m) => `map ${m} is not installed on the server`);
}
