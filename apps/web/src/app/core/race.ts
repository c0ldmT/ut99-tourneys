/** Monster Hunt time race helpers for the website (same rules as the adapter). */

export const MH_ADAPTER = 'ut99-mh';

export const isRace = (settings: { game: { adapter: string } } | undefined | null) =>
  settings?.game.adapter === MH_ADAPTER;

/** "4:07.3" (tenths) or "4:07" (`tenths` false). */
export function raceTime(ms: number, tenths = true): string {
  const t = Math.floor(Math.max(0, ms) / 100);
  const m = Math.floor(t / 600);
  const s = Math.floor((t % 600) / 10);
  const base = `${m}:${String(s).padStart(2, '0')}`;
  return tenths ? `${base}.${t % 10}` : base;
}

export interface RunView {
  entrantId: string;
  timeMs: number;
  deaths: number;
  penaltyMs: number;
  points: number;
  finished: boolean;
  forfeit?: boolean;
}

export const finalMs = (r: { timeMs: number; penaltyMs: number }) => r.timeMs + r.penaltyMs;
