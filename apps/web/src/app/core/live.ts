import type { ItemCounts, KillFeedEntry, LivePlayer } from './types';

/** Unreal units per metre (UT's scale: a player is about 1.8 m tall). */
export const UU_PER_M = 52.5;

export const PU_AMP = 1;
export const PU_BELT = 2;
export const PU_INVIS = 4;
export const PU_BOOTS = 8;

/** Health colour: overheal cyan, then green, gold, red. */
export function hpColor(h: number): string {
  return h > 100
    ? 'var(--accent)'
    : h > 60
      ? 'var(--live)'
      : h > 30
        ? 'var(--neuro)'
        : 'var(--danger-strong)';
}

export function pingClass(ping: number): string {
  return ping > 120 ? 'lc-ping bad' : ping > 70 ? 'lc-ping mid' : 'lc-ping';
}

export function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function meters(uu: number): number {
  return Math.max(1, Math.round(uu / UU_PER_M));
}

export interface SideSum {
  damage: number;
  items: ItemCounts;
  alive: number;
  count: number;
}

/** Damage, items and who is alive of one side. */
export function sideSum(players: readonly LivePlayer[], side: string): SideSum {
  const out: SideSum = {
    damage: 0,
    items: { amp: 0, belt: 0, armor: 0, keg: 0 },
    alive: 0,
    count: 0,
  };
  for (const p of players) {
    if (p.side !== side) continue;
    out.count++;
    if (p.alive) out.alive++;
    out.damage += p.damageDealt;
    for (const k of ['amp', 'belt', 'armor', 'keg'] as const) out.items[k] += p.items[k];
  }
  return out;
}

/** Percent widths of two parts of a split bar. */
export function split(a: number, b: number): [number, number] {
  const t = a + b;
  if (!t) return [0, 0];
  const pa = Math.round((a / t) * 100);
  return [pa, 100 - pa];
}

/**
 * Frag timeline `[sec, scoreA, scoreB]` of a deathmatch game: the samples so far plus the kills
 * that came after the last sample (kill feed entries with `sec`).
 */
export function withKills(
  samples: readonly number[][],
  kills: readonly KillFeedEntry[],
  sideA: string,
  sideB: string,
): number[][] {
  const out = samples.map((s) => [s[0] ?? 0, s[1] ?? 0, s[2] ?? 0]);
  let last = out.at(-1) ?? [0, 0, 0];
  for (const k of [...kills].sort((x, y) => (x.sec ?? 0) - (y.sec ?? 0))) {
    if ((k.kind ?? 'kill') !== 'kill' || k.chat !== undefined || k.sec === undefined) continue;
    if (k.sec <= (last[0] ?? 0)) continue;
    let [a, b] = [last[1] ?? 0, last[2] ?? 0];
    if (k.suicide || k.teamKill) {
      const side = k.suicide ? k.victimSide : k.killerSide;
      if (side === sideA) a--;
      else if (side === sideB) b--;
    } else if (k.killerSide === sideA) a++;
    else if (k.killerSide === sideB) b++;
    else continue;
    last = [k.sec, a, b];
    out.push(last);
  }
  return out;
}

export interface MomentumBar {
  x: number;
  y: number;
  w: number;
  h: number;
  side: 'a' | 'b' | 'even';
}

/** About 60 bars over the time axis, 5 to 30 s each. */
export function barStep(duration: number): number {
  return Math.min(30, Math.max(5, Math.round(duration / 60 / 5) * 5));
}

/** Bars of the frag difference (side a up, side b down) every `step` seconds; chart 600×150. */
export function momentumBars(
  samples: readonly number[][],
  duration: number,
  step = barStep(duration),
): MomentumBar[] {
  if (!samples.length || duration <= 0) return [];
  const end = samples.at(-1)![0] ?? 0;
  const diffAt = (sec: number) => {
    let d = 0;
    for (const s of samples) {
      if ((s[0] ?? 0) > sec) break;
      d = (s[1] ?? 0) - (s[2] ?? 0);
    }
    return d;
  };
  const points: [number, number][] = [];
  for (let t = step; t < end + step; t += step) points.push([Math.min(t, end), diffAt(t)]);
  const max = Math.max(3, ...points.map((p) => Math.abs(p[1])));
  const bw = (600 * step) / duration;
  return points.map(([t, d]) => {
    const h = d === 0 ? 1 : Math.max(2, Math.round((Math.abs(d) / max) * 68));
    return {
      x: Math.round(((t - step) / duration) * 6000) / 10,
      w: Math.max(1, Math.round((bw - 1.5) * 10) / 10),
      y: d > 0 ? 75 - h : d < 0 ? 75 : 74.5,
      h,
      side: d > 0 ? 'a' : d < 0 ? 'b' : 'even',
    };
  });
}

/** SVG path of a race run's points over its time (`[sec, points, ...]`), chart 600×150. */
export function racePath(
  samples: readonly number[][],
  duration: number,
  maxPoints: number,
): string {
  if (!samples.length || duration <= 0) return '';
  const y = (p: number) =>
    Math.round((145 - (Math.max(0, p) / Math.max(1, maxPoints)) * 135) * 10) / 10;
  const x = (s: number) => Math.round((Math.min(s, duration) / duration) * 6000) / 10;
  return `M0,145 ${samples.map((s) => `L${x(s[0] ?? 0)},${y(s[1] ?? 0)}`).join(' ')}`;
}

/** Feed entry time: seconds since the start of the game (run), else since the first entry. */
export function feedSec(e: { sec?: number; at: number }, firstAt: number): number {
  return e.sec ?? Math.max(0, Math.round((e.at - firstAt) / 1000));
}
