import { z } from 'zod';

/** Deathmatch: 1v1 and team deathmatch (settings.teamSize). */
export const ADAPTER_ID = 'ut99-dm';
/** Monster Hunt as a time race for teams (Monster Hunt 613 by Shrimp). */
export const ADAPTER_MH = 'ut99-mh';
export const GAME_ADAPTERS = [ADAPTER_ID, ADAPTER_MH] as const;

export type GameMode = 'dm' | 'tdm' | 'mh';

/** The game mode of a tournament. */
export function gameModeOf(settings: { teamSize: number; game: { adapter: string } }): GameMode {
  if (settings.game.adapter === ADAPTER_MH) return 'mh';
  return settings.teamSize > 1 ? 'tdm' : 'dm';
}

/**
 * UnrealScript package name of the mod. UT99 requires a new package name for every
 * network-incompatible release (clients cache packages by name), so this changes with the mod.
 */
export const MOD_PACKAGE = 'UTTourney_v1';
export const MOD_GAME_CLASS = `${MOD_PACKAGE}.TournamentDM`;
/** Team deathmatch (2on2, 3on3, 5on5): a subclass of TournamentDM with teams. */
export const MOD_TEAM_GAME_CLASS = `${MOD_PACKAGE}.TournamentTDM`;

/**
 * Monster Hunt lives in its own package (it depends on MonsterHunt.u, so the main package keeps
 * working on servers without Monster Hunt). Server-side only: clients do not download it.
 */
export const MOD_MH_PACKAGE = 'UTTourneyMH_v1';
export const MOD_MH_GAME_CLASS = `${MOD_MH_PACKAGE}.TournamentMH`;
export const MONSTER_HUNT_PACKAGE = 'MonsterHunt';

/** Game class the server runs for a game mode. */
export function gameClassFor(mode: GameMode): string {
  if (mode === 'mh') return MOD_MH_GAME_CLASS;
  return mode === 'tdm' ? MOD_TEAM_GAME_CLASS : MOD_GAME_CLASS;
}

/** https://ut99.org – "SmartStockBots" by Buggie: server-side mutator, no client download. */
export const SMART_STOCK_BOTS_PACKAGE = 'SmartStockBots';
export const SMART_STOCK_BOTS_ACTOR = `${SMART_STOCK_BOTS_PACKAGE}.SmartStockBots`;

/**
 * Suggested frag limit (team score in team games) and time limit per team size.
 * The website pre-fills them; they stay editable.
 */
export function defaultLimits(
  teamSize: number,
  mode: GameMode = teamSize > 1 ? 'tdm' : 'dm',
): { fragLimit: number; timeLimitMin: number } {
  // Monster Hunt: time limit per run, no frag limit.
  if (mode === 'mh') return { fragLimit: 0, timeLimitMin: 20 };
  switch (teamSize) {
    case 2:
      return { fragLimit: 30, timeLimitMin: 15 };
    case 3:
      return { fragLimit: 40, timeLimitMin: 15 };
    case 5:
      return { fragLimit: 60, timeLimitMin: 15 };
    default:
      return { fragLimit: 20, timeLimitMin: 10 };
  }
}

/**
 * Match rules for Deathmatch (1v1) and Team Deathmatch, editable per tournament on the website.
 * In team games the frag limit is the team score.
 */
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

    /** Team games only: damage dealt to team mates in percent. */
    friendlyFirePct: z.union([z.literal(0), z.literal(50), z.literal(100)]).default(0),

    /** Monster Hunt: seconds added to a run per death in the team (humans and bots). */
    penaltySec: z.number().int().min(0).max(60).default(5),
    /** Monster Hunt: monster difficulty 0 (easy) .. 7 (hardest), Monster Hunt's MonsterSkill. */
    monsterSkill: z.number().int().min(0).max(7).default(5),

    // Server-wide game settings (applied via ini at server start).
    weaponStay: z.boolean().default(true),
    hardcore: z.boolean().default(true),
    /** Game speed in percent, 100 = normal. */
    gameSpeedPct: z.number().int().min(50).max(200).default(100),
    /**
     * Load the SmartStockBots mutator (smarter stock bots) as a server actor. Needs
     * SmartStockBots.u in the server's System folder; clients need nothing.
     */
    smartStockBots: z.boolean().default(false),
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

/**
 * Checks a tournament's game settings beyond the rules schema (adapter, mode-specific rules).
 * Returns human-readable problems.
 */
export function gameProblems(settings: {
  teamSize: number;
  game: { adapter: string; rules: unknown };
}): string[] {
  if (!(GAME_ADAPTERS as readonly string[]).includes(settings.game.adapter)) {
    return [`unknown game adapter ${settings.game.adapter}`];
  }
  let rules: Ut99DmRules;
  try {
    rules = parseRules(settings.game.rules);
  } catch (e) {
    return [
      `invalid game rules: ${e instanceof z.ZodError ? z.prettifyError(e) : (e as Error).message}`,
    ];
  }
  const problems: string[] = [];
  const mh = settings.game.adapter === ADAPTER_MH;
  if (mh) {
    if (settings.teamSize < 2) problems.push('Monster Hunt is played by teams (2, 3 or 5 players)');
    if (rules.timeLimitMin <= 0) problems.push('Monster Hunt needs a time limit per run');
  }
  const isMhMap = (m: string) => m.toUpperCase().startsWith('MH-');
  const wrong = rules.mapPool.filter((m) => isMhMap(m) !== mh);
  if (wrong.length)
    problems.push(
      `${mh ? 'not a Monster Hunt map' : 'Monster Hunt map in a deathmatch tournament'}: ${wrong.join(', ')}`,
    );
  return problems;
}

/** Checks rules against what the server actually has installed. Returns human-readable problems. */
export function validateAgainstInventory(
  rules: Ut99DmRules,
  inventory: { maps: readonly { id: string }[]; packages?: readonly string[] },
  mode: GameMode = 'dm',
): string[] {
  const available = new Set(inventory.maps.map((m) => m.id.toLowerCase()));
  const problems = rules.mapPool
    .filter((m) => !available.has(m.toLowerCase()))
    .map((m) => `map ${m} is not installed on the server`);
  const packages = new Set((inventory.packages ?? []).map((p) => p.toLowerCase()));
  if (
    rules.smartStockBots &&
    inventory.packages &&
    !packages.has(SMART_STOCK_BOTS_PACKAGE.toLowerCase())
  ) {
    problems.push(`${SMART_STOCK_BOTS_PACKAGE}.u is not installed on the server (System folder)`);
  }
  if (mode === 'mh' && inventory.packages) {
    for (const pkg of [MONSTER_HUNT_PACKAGE, MOD_MH_PACKAGE]) {
      if (!packages.has(pkg.toLowerCase()))
        problems.push(`${pkg}.u is not installed on the server (System folder)`);
    }
  }
  return problems;
}
