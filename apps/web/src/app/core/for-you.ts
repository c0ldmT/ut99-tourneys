import type { UdtAreaId } from './udt-areas';
import type { UdtHub } from './types';

/** Bots in a full lineup (the hub counts the lineup slots taken). */
export const LINEUP_SIZE = 5;
/** A game this close (hours) with an incomplete lineup cannot be put off. */
export const SOON_HOURS = 48;

/** One thing for the manager to do (decision 311). */
export interface ForYouItem {
  id: 'lineup' | 'trades' | 'cup' | 'points' | 'prestige' | 'squad' | 'market';
  area: UdtAreaId;
  /** A game is close and the lineup is incomplete: shown first, cannot be put off. */
  urgent: boolean;
  /** i18n key and parameters of the sentence. */
  title: string;
  params: Record<string, string | number>;
  /** Context line: a key with parameters, or null. */
  sub: { key: string; params: Record<string, string | number> } | null;
  /** i18n key of the button and where it leads. */
  action: string;
  link: string;
}

/**
 * What needs the manager, most urgent first, from the hub's state (decision 311): an incomplete
 * lineup (urgent before a league game or an entered cup within two days), trade offers, a cup
 * with sign-up open, development and prestige points, striking or tired bots, the market day
 * within a day. Nothing without a team.
 */
export function forYou(hub: UdtHub): ForYouItem[] {
  const m = hub.team;
  if (!m || hub.season === null) return [];
  const now = Date.parse(hub.now);
  const hours = (iso: string | null | undefined) =>
    iso ? (Date.parse(iso) - now) / 3_600_000 : Infinity;
  const soon = (iso: string | null | undefined) => {
    const h = hours(iso);
    return h >= -1 && h <= SOON_HOURS;
  };
  const out: ForYouItem[] = [];
  const next = hub.league.next;
  const cup = hub.cups?.next ?? null;
  if (m.lineup < LINEUP_SIZE) {
    const league = next && soon(next.at) ? next : null;
    const cupSoon = !league && cup?.entered && soon(cup.at) ? cup : null;
    out.push({
      id: 'lineup',
      area: 'team',
      urgent: !!(league || cupSoon),
      title: 'udt.fd.lineup',
      params: { n: m.lineup, of: LINEUP_SIZE },
      sub: league
        ? {
            key: 'udt.fd.lineupLeague',
            params: {
              at: league.at,
              matchday: league.matchday ?? 0,
              kind: league.kind,
              opp: league.opponent,
            },
          }
        : cupSoon
          ? { key: 'udt.fd.lineupCup', params: { at: cupSoon.at ?? '', name: cupSoon.name } }
          : { key: 'udt.fd.lineupHint', params: { of: LINEUP_SIZE } },
      action: 'udt.fd.go.lineup',
      link: '/udt/team',
    });
  }
  const trades = hub.transfers.tradesIn;
  if (trades > 0)
    out.push({
      id: 'trades',
      area: 'trans',
      urgent: false,
      title: 'udt.fd.trades',
      params: { n: trades },
      sub: null,
      action: 'udt.fd.go.trades',
      link: '/udt/trades',
    });
  if (cup && !cup.entered && (hub.cups?.open ?? 0) > 0)
    out.push({
      id: 'cup',
      area: 'cups',
      urgent: false,
      title: 'udt.fd.cup',
      params: { name: cup.name },
      sub: cup.at ? { key: 'udt.fd.cupAt', params: { at: cup.at } } : null,
      action: 'udt.fd.go.cup',
      link: '/udt/events',
    });
  if (m.points > 0)
    out.push({
      id: 'points',
      area: 'team',
      urgent: false,
      title: 'udt.fd.points',
      params: { n: m.points },
      sub: null,
      action: 'udt.fd.go.points',
      link: '/udt/team',
    });
  if ((m.prestige ?? 0) > 0)
    out.push({
      id: 'prestige',
      area: 'team',
      urgent: false,
      title: 'udt.fd.prestige',
      params: { n: m.prestige ?? 0 },
      sub: null,
      action: 'udt.fd.go.points',
      link: '/udt/team',
    });
  if (m.striking > 0 || m.tired > 0)
    out.push({
      id: 'squad',
      area: 'team',
      urgent: false,
      title: m.striking > 0 ? 'udt.fd.striking' : 'udt.fd.tired',
      params: { n: m.striking > 0 ? m.striking : m.tired },
      sub:
        m.striking > 0 && m.tired > 0 ? { key: 'udt.fd.tiredToo', params: { n: m.tired } } : null,
      action: 'udt.fd.go.squad',
      link: '/udt/team',
    });
  const market = hub.transfers.marketAt;
  if (market && hours(market) >= 0 && hours(market) <= 24)
    out.push({
      id: 'market',
      area: 'trans',
      urgent: false,
      title: 'udt.fd.market',
      params: { at: market },
      sub: null,
      action: 'udt.fd.go.market',
      link: '/udt/market',
    });
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent));
}

/** A step of the first steps (decision 312). */
export interface FirstStep {
  id: 'team' | 'lineup' | 'cup' | 'market' | 'pack';
  done: boolean;
  link: string;
}

/**
 * The first steps of a manager new this season (decision 312), or null when there are none to
 * show (no season, a manager of an earlier season, or all done).
 */
export function firstSteps(hub: UdtHub): FirstStep[] | null {
  const o = hub.onboarding;
  if (hub.season === null || !o) return null;
  const steps: FirstStep[] = [
    { id: 'team', done: !!hub.team, link: '/udt/team' },
    { id: 'lineup', done: (hub.team?.lineup ?? 0) >= LINEUP_SIZE, link: '/udt/team' },
    { id: 'cup', done: o.cup, link: '/udt/events' },
    { id: 'market', done: o.market, link: '/udt/market' },
    { id: 'pack', done: o.pack, link: '/udt/packs' },
  ];
  return steps.every((s) => s.done) ? null : steps;
}
