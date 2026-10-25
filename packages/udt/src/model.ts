/**
 * The game model of the simulations (season simulator, the test mode's simulated matches, later
 * the league's simulated AI games): a bot's strength from its skill and play-style values, and
 * the chance that one side wins a game.
 */

/** Strength per skill: the owner's brackets (0-3 weak, 4-5 middle, 6-7 far above). */
export const SKILL_STRENGTH: readonly number[] = [1, 1.25, 1.6, 2.1, 3.4, 4.6, 7.2, 9.5];

/** Strength of one bot: its skill, moved by its value score (0..1, see `valueScore`) ±15 %. */
export function botStrength(skill: number, score: number): number {
  return SKILL_STRENGTH[Math.round(Math.min(7, Math.max(0, skill)))]! * (0.85 + 0.3 * score);
}

/**
 * Exponent of the model `p = sA^k / (sA^k + sB^k)`, calibrated on real games (the owner's
 * export of 25.10.2026, 327 deathmatch games, `pnpm --filter @tourney/api udt:calibrate`):
 * 1v1 k = 3 (log loss 0.461, k = 2 gave 0.478), teams k = 4.5 (0.418 against 0.484; the best
 * fit 4.75 is within noise). With k = 2 the favourite of a one-skill gap won 68 % in the model
 * and 77 % in the games; with k = 3 the model says 76 %.
 */
export const GAME_MODEL_K = { duel: 3, team: 4.5 } as const;

/** Chance that side A wins a game; `sa`, `sb`: side strengths (sums or means of the bots). */
export function gameChance(sa: number, sb: number, teamSize = 1): number {
  const k = teamSize > 1 ? GAME_MODEL_K.team : GAME_MODEL_K.duel;
  if (sa <= 0 && sb <= 0) return 0.5;
  const a = Math.max(0, sa) ** k;
  const b = Math.max(0, sb) ** k;
  return a / (a + b);
}
