import type Database from 'better-sqlite3';
import { botStrength, gameChance, GAME_MODEL_K, valueScore } from '@tourney/udt';

/**
 * Calibration of the game model on real games (`pnpm --filter @tourney/api udt:calibrate`):
 * reads the finished bot-against-bot deathmatch games of a website database (best an anonymised
 * export, see `db:anonymize`) and checks how well `p = sA^k / (sA^k + sB^k)` predicts them, per
 * exponent k, separately for 1v1 and teams. Also fits the rating setting `levelPoints` (rating
 * points per skill step) to the same games. Pure apart from reading the database.
 */

interface BotSpec {
  skill: number;
  traits?: Record<string, unknown>;
}

/** One finished game between two sides of bots. */
export interface CalibrationGame {
  teamSize: number;
  a: BotSpec[];
  b: BotSpec[];
  /** Side A won. */
  winA: boolean;
}

interface SeedEntrant {
  id: string;
  kind: string;
  bot?: BotSpec;
  bots?: BotSpec[];
  members?: unknown[];
}

/** The bots of an entrant made of bots only (a bot, or a team without players), else undefined. */
function botSide(en: SeedEntrant | undefined): BotSpec[] | undefined {
  if (en?.kind === 'bot' && en.bot) return [en.bot];
  if (en?.kind === 'team' && !en.members?.length && en.bots?.length) return en.bots;
  return undefined;
}

/** Bot-against-bot deathmatch games of every tournament, in event order. */
export function readCalibrationGames(db: Database.Database): CalibrationGame[] {
  const out: CalibrationGame[] = [];
  const tours = db.prepare('SELECT id, settings_json FROM tournaments').all() as {
    id: string;
    settings_json: string;
  }[];
  const events = db.prepare(
    "SELECT type, json FROM events WHERE tournament_id = ? AND type IN ('seeding.set', 'entrant.replaced', 'match.gameFinished') ORDER BY seq",
  );
  for (const t of tours) {
    let settings: { teamSize?: number; game?: { adapter?: string } };
    try {
      settings = JSON.parse(t.settings_json);
    } catch {
      continue;
    }
    if (settings.game?.adapter !== 'ut99-dm') continue;
    const teamSize = settings.teamSize ?? 1;
    let sides = new Map<string, BotSpec[]>();
    for (const e of events.all(t.id) as { type: string; json: string }[]) {
      let data: Record<string, unknown>;
      try {
        data = (JSON.parse(e.json) as { data?: Record<string, unknown> }).data ?? {};
      } catch {
        continue;
      }
      if (e.type === 'seeding.set') {
        sides = new Map();
        for (const en of (data.entrants ?? []) as SeedEntrant[]) {
          const bots = botSide(en);
          if (bots) sides.set(en.id, bots);
        }
        continue;
      }
      if (e.type === 'entrant.replaced') {
        const id = data.entrantId as string;
        const bots = botSide(data.replacement as SeedEntrant);
        if (bots) sides.set(id, bots);
        else sides.delete(id);
        continue;
      }
      const scores = (data.scores ?? {}) as Record<string, number>;
      const ids = Object.keys(scores);
      if (ids.length !== 2 || !data.winnerId) continue;
      const a = sides.get(ids[0]!);
      const b = sides.get(ids[1]!);
      // Only games where both sides are bots (a side with a human has no skill to model).
      if (!a || !b) continue;
      out.push({ teamSize, a, b, winA: data.winnerId === ids[0] });
    }
  }
  return out;
}

/** Mean model strength of a side (as the simulator, without the small body-trait bonus). */
const sideStrength = (s: BotSpec[]) =>
  s.reduce((x, b) => x + botStrength(b.skill, valueScore(b.traits as never)), 0) / s.length;
const meanSkill = (s: BotSpec[]) => s.reduce((x, b) => x + b.skill, 0) / s.length;
const clampP = (p: number) => Math.min(0.999, Math.max(0.001, p));
const powChance = (sa: number, sb: number, k: number) => {
  const a = sa ** k;
  const b = sb ** k;
  return a / (a + b);
};

/** Mean log loss of the model with exponent k (lower is better, a coin toss gives ln 2). */
export function logLoss(games: CalibrationGame[], k: number): number {
  let sum = 0;
  for (const g of games) {
    const p = clampP(powChance(sideStrength(g.a), sideStrength(g.b), k));
    sum -= Math.log(g.winA ? p : 1 - p);
  }
  return games.length ? sum / games.length : Math.LN2;
}

/** Exponent with the lowest log loss on a grid 0.25..12 (step 0.25). */
export function bestK(games: CalibrationGame[]): { k: number; logLoss: number } {
  let best = { k: 2, logLoss: Infinity };
  for (let k = 0.25; k <= 12; k += 0.25) {
    const l = logLoss(games, k);
    if (l < best.logLoss) best = { k, logLoss: l };
  }
  return best;
}

/** Favourite's win rate per skill gap (side means, rounded to 0.5, capped at 3) against the model. */
export function buckets(games: CalibrationGame[], teamSize: number) {
  const map = new Map<number, { n: number; won: number; model: number }>();
  for (const g of games) {
    const d = meanSkill(g.a) - meanSkill(g.b);
    const gap = Math.min(3, Math.round(Math.abs(d) * 2) / 2);
    const pa = gameChance(sideStrength(g.a), sideStrength(g.b), teamSize);
    // The favourite: the side with the higher mean skill, on a tie the model's favourite.
    const favA = d !== 0 ? d > 0 : pa >= 0.5;
    const e = map.get(gap) ?? { n: 0, won: 0, model: 0 };
    e.n++;
    if (g.winA === favA) e.won++;
    e.model += favA ? pa : 1 - pa;
    map.set(gap, e);
  }
  return [...map]
    .sort((x, y) => x[0] - y[0])
    .map(([gap, e]) => ({ gap, n: e.n, won: e.won / e.n, model: e.model / e.n }));
}

/**
 * Rating points per skill step that predict the games best with the Elo formula of the shown
 * ratings (`1 / (1 + 10^(-diff / 400))`, as the bot bettors use), grid 25..500 (step 25).
 */
export function bestLevelPoints(games: CalibrationGame[]): {
  levelPoints: number;
  logLoss: number;
} {
  let best = { levelPoints: 100, logLoss: Infinity };
  for (let lp = 25; lp <= 500; lp += 25) {
    let sum = 0;
    for (const g of games) {
      const p = clampP(1 / (1 + 10 ** ((-(meanSkill(g.a) - meanSkill(g.b)) * lp) / 400)));
      sum -= Math.log(g.winA ? p : 1 - p);
    }
    const l = games.length ? sum / games.length : Math.LN2;
    if (l < best.logLoss) best = { levelPoints: lp, logLoss: l };
  }
  return best;
}

export interface CalibrationGroup {
  label: 'duel' | 'team';
  n: number;
  /** Exponent the code uses now (GAME_MODEL_K). */
  k: number;
  logLoss: number;
  /** Log loss of the old model (k = 2) for comparison. */
  logLossK2: number;
  best: { k: number; logLoss: number };
  buckets: ReturnType<typeof buckets>;
}

/** Full report: per group (1v1, teams) and the fitted levelPoints over all games. */
export function calibrate(games: CalibrationGame[]) {
  const groups: CalibrationGroup[] = [];
  for (const label of ['duel', 'team'] as const) {
    const l = games.filter((g) => (label === 'duel' ? g.teamSize === 1 : g.teamSize > 1));
    const k = GAME_MODEL_K[label];
    groups.push({
      label,
      n: l.length,
      k,
      logLoss: logLoss(l, k),
      logLossK2: logLoss(l, 2),
      best: bestK(l),
      buckets: buckets(l, label === 'duel' ? 1 : 2),
    });
  }
  return { games: games.length, groups, levelPoints: bestLevelPoints(games) };
}
