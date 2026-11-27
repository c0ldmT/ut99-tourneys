/**
 * How long a bracket takes at most (decision 324): every match goes to its last game, every game
 * to the time limit, with a few minutes between games. Parallel matches play the matches of a
 * round side by side, at most as many as servers; a round waits for its slowest batch.
 */

/** Minutes between two games of a match (map change, countdown, vote). */
export const BETWEEN_GAMES_MIN = 3;

export interface BracketShape {
  format: 'single' | 'double';
  size: number;
  boDefault: number;
  /** 0: as `boDefault`. */
  boSemi: number;
  boFinal: number;
  boLbFinal: number;
  boGrand: number;
  grandFinalReset: boolean;
}

/** One round: how many matches and the best of each. */
export interface Round {
  matches: number;
  bestOf: number;
}

/** The rounds of the bracket: winners' side, losers' side (double elimination), grand final. */
export function bracketRounds(f: BracketShape): Round[] {
  const rounds = Math.round(Math.log2(f.size));
  const bo = (x: number) => x || f.boDefault;
  const out: Round[] = [];
  for (let r = 1; r <= rounds; r++) {
    const bestOf = r === rounds ? bo(f.boFinal) : r === rounds - 1 ? bo(f.boSemi) : f.boDefault;
    out.push({ matches: f.size / 2 ** r, bestOf });
  }
  if (f.format === 'double' && rounds > 1) {
    // Losers' side: 2 × (rounds - 1) rounds, two of each size; its last one is its final.
    const lb = 2 * (rounds - 1);
    for (let k = 1; k <= lb; k++)
      out.push({
        matches: f.size / 2 ** (Math.floor((k + 1) / 2) + 1),
        bestOf: k === lb ? bo(f.boLbFinal) : f.boDefault,
      });
    for (let i = 0; i < (f.grandFinalReset ? 2 : 1); i++)
      out.push({ matches: 1, bestOf: bo(f.boGrand) });
  }
  return out;
}

/** Games of the bracket if every match goes the distance. */
export function maxGames(f: BracketShape): number {
  return bracketRounds(f).reduce((n, r) => n + r.matches * r.bestOf, 0);
}

/** Minutes at most, with `servers` matches at once (1: one after the other). */
export function maxMinutes(f: BracketShape, gameMin: number, servers = 1): number {
  const per = Math.max(1, Math.floor(servers));
  const games = bracketRounds(f).reduce((n, r) => n + Math.ceil(r.matches / per) * r.bestOf, 0);
  return games * (gameMin + BETWEEN_GAMES_MIN);
}

/** "2 h 10 min", "45 min". */
export function hoursText(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}
