/**
 * Careers of all bots (one model): age in seasons played, a career level from all their games,
 * the phase of the career (rookie, rising, peak, veteran, decline) and the form of the day.
 * Phase and form change a bot's accuracy in Dream Team games only, the phase also its value.
 */
import { levelOf } from './traits.js';

export type CareerPhase = 'rookie' | 'rising' | 'peak' | 'veteran' | 'decline';
export type CareerForm = 'hot' | 'normal' | 'cold';

/** A season counts for the age with at least this many games (all tournaments). */
export const AGE_GAMES = 5;
/** From this age on (in decline) the website suggests retirement. */
export const RETIRE_AGE = 12;

export function careerPhase(age: number): CareerPhase {
  if (age <= 1) return 'rookie';
  if (age <= 3) return 'rising';
  if (age <= 6) return 'peak';
  if (age <= 9) return 'veteran';
  return 'decline';
}

/** Effect of the phase in Dream Team games: accuracy on the 0..100 scale, market value. */
export const PHASE_EFFECT: Readonly<Record<CareerPhase, { accuracy: number; value: number }>> = {
  rookie: { accuracy: -2, value: 1 },
  rising: { accuracy: 0, value: 1 },
  peak: { accuracy: 5, value: 1.1 },
  veteran: { accuracy: 2, value: 1 },
  decline: { accuracy: -6, value: 0.85 },
};

/** Share of the days a bot is in form, and out of form (the rest: normal). */
export const FORM_CHANCE = { hot: 0.2, cold: 0.2 } as const;

/**
 * Effect of the form of the day in Dream Team games: accuracy on the 0..100 scale (owner,
 * 22.10.). ±10 like tiredness: the duel simulation (curve v1) gives in form against out of form
 * about 55 % at the same level, ±2 only about 51 % (the level decides far more).
 */
export const FORM_EFFECT: Readonly<Record<CareerForm, number>> = { hot: 10, normal: 0, cold: -10 };

/**
 * Form of the day: random but fixed per bot and day (`day` as YYYY-MM-DD in the season's time
 * zone), the same for every page and the seeding of that day.
 */
export function dailyForm(botId: string, day: string): CareerForm {
  let h = 0x811c9dc5;
  for (const ch of `${botId}|${day}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // A final mix so that neighbouring days are not alike.
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b) >>> 0;
  h ^= h >>> 16;
  const u = (h >>> 0) / 4294967296;
  if (u < FORM_CHANCE.hot) return 'hot';
  if (u >= 1 - FORM_CHANCE.cold) return 'cold';
  return 'normal';
}

export interface CareerInput {
  /** Games per season (all tournaments and Dream Team games), any order. */
  seasons: { season: number; games: number; wins: number }[];
  /** The running season. */
  current?: number;
  /** Bot and day of the form (without: normal). */
  id?: string;
  day?: string;
}

export interface Career {
  age: number;
  phase: CareerPhase;
  level: number;
  games: number;
  wins: number;
  /** Form of the day (random per bot and day). */
  form: CareerForm;
  /** First and last season with games. */
  from: number | null;
  to: number | null;
  retire: boolean;
}

/** Career XP like Dream Team experience: 10 per game, 15 more per win. */
export function career(input: CareerInput): Career {
  const played = input.seasons.filter((s) => s.games >= AGE_GAMES);
  const age = played.length;
  const games = input.seasons.reduce((n, s) => n + s.games, 0);
  const wins = input.seasons.reduce((n, s) => n + s.wins, 0);
  const any = input.seasons.filter((s) => s.games > 0).map((s) => s.season);
  const phase = careerPhase(age);
  return {
    age,
    phase,
    level: levelOf(games * 10 + wins * 15),
    games,
    wins,
    form: input.id && input.day ? dailyForm(input.id, input.day) : 'normal',
    from: any.length ? Math.min(...any) : null,
    to: any.length ? Math.max(...any) : null,
    retire: phase === 'decline' && age >= RETIRE_AGE,
  };
}
