/**
 * Signatures (plan P4, `claude/Plan-P4-Markt.md`, decision 271): a library bot earns one small
 * effect of its own from its career - not a trait (no slot, not craftable, never removed). It
 * comes at the season change for bots of age 2 and career level 10 from their lifetime
 * statistics (the strongest mark against the average of their skill), stays with the bot for
 * good and gets stronger (level 2, ★) from career level 20. It plays in Dream Team only.
 */

export type SignatureCode =
  'weapon' | 'marksman' | 'streak' | 'multi' | 'tough' | 'opener' | 'home';

/** In the order of the plan's table (A, B, C, D, F, G, H). */
export const SIGNATURES: readonly SignatureCode[] = [
  'weapon',
  'marksman',
  'streak',
  'multi',
  'tough',
  'opener',
  'home',
];

export interface Signature {
  code: SignatureCode;
  /** 1, or 2 (★) from `SIGNATURE_STAR_LEVEL`. */
  level: 1 | 2;
  /** Leibwaffe: the weapon's class name in the game (e.g. "ShockRifle"). */
  weapon?: string;
  /** Lieblings-Map: the map's name (e.g. "DM-Deck16]["). */
  map?: string;
  /** The season it was earned in. */
  since: number;
}

/** Who earns one: seasons with games (career age) and the career level. */
export const SIGNATURE_AGE = 2;
export const SIGNATURE_LEVEL = 10;
/** The stronger level 2 (★) from this career level. */
export const SIGNATURE_STAR_LEVEL = 20;

/**
 * Effects per level [1, 2]: damage share (weapon: with its weapon; streak: from 3 kills without
 * dying; multi: 3 s after a kill; opener: 8 s after the spawn), damage taken less (tough: below
 * 40 health), aim error less (marksman: sniper rifle and enforcer; home: aim and reaction on
 * its map). Sized with `bot:sim` (Inhuman against Inhuman, 8,000 duels; the timed ones with
 * `SIGNATURE_UPTIME`): level 1 ≈ 20 % of a skill step (≈ 3 prestige points), level 2 ≈ 30 %
 * (≈ 5 points) - below an own bot's endgame (Godlike 6 points ≈ 38 %, ★5 ≈ 60 %), so own bots
 * stay ahead of bought ones (concept section 2). The timed ones are estimates until the trait
 * log of season 3 shows how long they are on.
 */
export const SIGNATURE_EFFECT: Readonly<Record<SignatureCode, readonly [number, number]>> = {
  weapon: [0.15, 0.25],
  marksman: [0.2, 0.3],
  streak: [0.35, 0.5],
  multi: [0.5, 0.75],
  tough: [0.1, 0.2],
  opener: [0.35, 0.5],
  home: [0.1, 0.15],
};

/** Conditions of the effects in the game (the mod uses the same numbers). */
export const SIGNATURE_STREAK_KILLS = 3;
export const SIGNATURE_MULTI_SEC = 3;
export const SIGNATURE_OPENER_SEC = 8;
export const SIGNATURE_TOUGH_HEALTH = 40;

/** Weapon names in the statistics (the game's item names) to the game's class names. */
export const WEAPON_CLASS_OF: Readonly<Record<string, string>> = {
  'Shock Rifle': 'ShockRifle',
  'Rocket Launcher': 'UT_Eightball',
  'Flak Cannon': 'UT_FlakCannon',
  'Sniper Rifle': 'SniperRifle',
  'GES Bio Rifle': 'ut_biorifle',
  Minigun: 'minigun2',
  'Pulse Gun': 'PulseGun',
  Ripper: 'ripper',
  Enforcer: 'enforcer',
  'Double Enforcer': 'enforcer',
  'Impact Hammer': 'ImpactHammer',
  Chainsaw: 'ChainSaw',
};

/** The numbers of a bot's lifetime statistics a signature is drawn from. */
export interface SignatureProfile {
  botId: string;
  skill: number;
  age: number;
  careerLevel: number;
  /** Games with statistics from the mod, kills, deaths, time. */
  statGames: number;
  kills: number;
  deaths: number;
  headshots: number;
  sprees: number;
  multiKills: number;
  firstBloods: number;
  /** Games with damage data and the damage taken in them. */
  damageGames: number;
  damageTaken: number;
  /** The weapon with the most kills (item name) and its kills. */
  favoriteWeapon?: { name: string; kills: number };
  /** Won and played games per map (deathmatch), and overall. */
  maps: { map: string; games: number; won: number }[];
  games: number;
  gamesWon: number;
}

/** Enough numbers for a fair mark: statistic games, kills, games on the favourite map. */
export const SIGNATURE_MIN_STAT_GAMES = 20;
export const SIGNATURE_MIN_KILLS = 100;
export const SIGNATURE_MAP_GAMES = 20;
/** A weapon counts from this share of the kills. */
export const SIGNATURE_WEAPON_SHARE = 0.35;

/** Whether a bot can earn a signature now (age and career level). */
export const signatureEligible = (p: Pick<SignatureProfile, 'age' | 'careerLevel'>): boolean =>
  p.age >= SIGNATURE_AGE && p.careerLevel >= SIGNATURE_LEVEL;

export const signatureLevel = (careerLevel: number): 1 | 2 =>
  careerLevel >= SIGNATURE_STAR_LEVEL ? 2 : 1;

/** The marks of a profile (higher is more; null: not enough numbers or not that kind of bot). */
function marks(p: SignatureProfile): Partial<Record<SignatureCode, number>> {
  const out: Partial<Record<SignatureCode, number>> = {};
  if (p.statGames < SIGNATURE_MIN_STAT_GAMES || p.kills < SIGNATURE_MIN_KILLS) return out;
  const fav = p.favoriteWeapon;
  // The share of every bot makes the average; only a share from 35 % can win (below).
  if (fav && WEAPON_CLASS_OF[fav.name]) out.weapon = fav.kills / p.kills;
  out.marksman = p.headshots / p.kills;
  out.streak = p.sprees / p.statGames;
  out.multi = p.multiKills / p.kills;
  if (p.damageGames >= SIGNATURE_MIN_STAT_GAMES && p.deaths > 0) {
    // Damage taken per death, as health it took to kill the bot: more is tougher.
    out.tough = p.damageTaken / Math.max(1, p.deaths * (p.damageGames / p.statGames));
  }
  out.opener = p.firstBloods / p.statGames;
  const all = p.games > 0 ? p.gamesWon / p.games : 0;
  const best = [...p.maps]
    .filter((m) => m.games >= SIGNATURE_MAP_GAMES)
    .sort((a, b) => b.won / b.games - a.won / a.games)[0];
  if (best && all > 0) out.home = best.won / best.games / all;
  return out;
}

/**
 * The signatures bots earn now: for every eligible profile without one (`held`), the mark that
 * stands out most against the average of the bots of its skill (a ratio; `home` is a ratio to
 * its own win rate already, so its average is 1). Level 2 from career level 20; a held signature
 * is upgraded then (same code). Pure; the caller stores the result.
 */
export function drawSignatures(
  profiles: readonly SignatureProfile[],
  held: ReadonlyMap<string, Signature>,
  season: number,
): Map<string, Signature> {
  const all = profiles.map((p) => ({ p, m: marks(p) }));
  // Averages of every mark per skill (bots with numbers).
  const avg = new Map<string, number>();
  for (const code of SIGNATURES) {
    if (code === 'home') continue;
    const per = new Map<number, number[]>();
    for (const { p, m } of all) {
      const v = m[code];
      if (v === undefined) continue;
      const k = Math.round(p.skill);
      per.set(k, [...(per.get(k) ?? []), v]);
    }
    for (const [k, l] of per) avg.set(`${code}:${k}`, l.reduce((a, b) => a + b, 0) / l.length);
  }
  const out = new Map<string, Signature>();
  for (const { p, m } of all) {
    if (!signatureEligible(p)) continue;
    const level = signatureLevel(p.careerLevel);
    const had = held.get(p.botId);
    if (had) {
      if (had.level < level) out.set(p.botId, { ...had, level });
      continue;
    }
    let best: { code: SignatureCode; score: number } | null = null;
    for (const code of SIGNATURES) {
      const v = m[code];
      if (v === undefined) continue;
      if (code === 'weapon' && v < SIGNATURE_WEAPON_SHARE) continue;
      const base = code === 'home' ? 1 : avg.get(`${code}:${Math.round(p.skill)}`);
      if (!base || base <= 0) continue;
      const score = v / base;
      if (!best || score > best.score) best = { code, score };
    }
    if (!best) continue;
    const sig: Signature = { code: best.code, level, since: season };
    if (best.code === 'weapon') sig.weapon = WEAPON_CLASS_OF[p.favoriteWeapon!.name];
    if (best.code === 'home')
      sig.map = [...p.maps]
        .filter((x) => x.games >= SIGNATURE_MAP_GAMES)
        .sort((a, b) => b.won / b.games - a.won / a.games)[0]!.map;
    out.set(p.botId, sig);
  }
  return out;
}

/** The effect of a signature (its level's number). */
export const signatureEffect = (s: Pick<Signature, 'code' | 'level'>): number =>
  SIGNATURE_EFFECT[s.code][s.level - 1] ?? 0;

/**
 * A signature in the game model (frags a minute, like `TRAIT_EFFECT`): 20 % and 30 % of a skill
 * step (≈ 1.7 a minute).
 */
export const SIGNATURE_STRENGTH: readonly [number, number] = [0.35, 0.5];
export const signatureStrength = (s: Pick<Signature, 'level'> | null | undefined): number =>
  s ? (SIGNATURE_STRENGTH[s.level - 1] ?? 0) : 0;

/** The bsig line of the mod (0.21.0): code letter, level, weapon or map. */
export const SIGNATURE_MOD: Readonly<Record<SignatureCode, string>> = {
  weapon: 'w',
  marksman: 'm',
  streak: 's',
  multi: 'k',
  tough: 't',
  opener: 'o',
  home: 'h',
};

/** "w2" style code of a signature for the game (null: none). */
export const signatureModCode = (s: Signature | null | undefined): string | null =>
  s ? `${SIGNATURE_MOD[s.code]}${s.level}` : null;
