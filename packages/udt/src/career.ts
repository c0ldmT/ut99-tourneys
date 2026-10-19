/**
 * Careers of all bots (one model): age in seasons played, a career level from all their games,
 * the phase of the career (rookie, rising, peak, veteran, decline) and the form of the season.
 * The phase changes a bot's accuracy and market value in Dream Team games only.
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

/** Form of the running season: wins against the share a bot of average luck would have. */
export function careerForm(games: number, wins: number): CareerForm {
  if (games < 5) return 'normal';
  const r = wins / games;
  if (r >= 0.65) return 'hot';
  if (r <= 0.3) return 'cold';
  return 'normal';
}

export interface CareerInput {
  /** Games per season (all tournaments and Dream Team games), any order. */
  seasons: { season: number; games: number; wins: number }[];
  /** The running season (its form). */
  current?: number;
}

export interface Career {
  age: number;
  phase: CareerPhase;
  level: number;
  games: number;
  wins: number;
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
  const cur = input.seasons.find((s) => s.season === input.current);
  const any = input.seasons.filter((s) => s.games > 0).map((s) => s.season);
  const phase = careerPhase(age);
  return {
    age,
    phase,
    level: levelOf(games * 10 + wins * 15),
    games,
    wins,
    form: cur ? careerForm(cur.games, cur.wins) : 'normal',
    from: any.length ? Math.min(...any) : null,
    to: any.length ? Math.max(...any) : null,
    retire: phase === 'decline' && age >= RETIRE_AGE,
  };
}
