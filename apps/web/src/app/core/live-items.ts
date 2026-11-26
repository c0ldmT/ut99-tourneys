import type { LiveListItem } from '../components/live-list';
import type { LeagueTag, NowMatch, Phase } from './types';

type T = (key: string, params?: Record<string, string | number>) => string;

/** Frags of a match being played ("12:9"), null before the first telemetry. */
export function scoreOf(n: Pick<NowMatch, 'entrants' | 'live'>): string | null {
  const s = n.live?.scores;
  return s ? `${s[n.entrants[0]] ?? 0}:${s[n.entrants[1]] ?? 0}` : null;
}

/** A match being played as a row of the live list (decision 294). */
export function nowItem(
  n: NowMatch,
  t: T,
  o: { key?: string; label?: string; link?: unknown[]; mine?: boolean } = {},
): LiveListItem {
  const phase = n.live?.phase;
  return {
    key: o.key ?? n.matchId,
    label: o.label ?? n.matchId,
    names: n.names,
    score: scoreOf(n),
    server: n.server ?? '',
    live: phase === 'live' || phase === 'overtime',
    status: t(`list.phase.${phase ?? 'waiting'}`),
    ...(o.link ? { link: o.link } : {}),
    ...(o.mine ? { mine: true } : {}),
  };
}

/** The name of a league game in lists: its matchday, or its kind (final, relegation, ...). */
export function leagueLabel(l: { kind: string; matchday: number | null }, t: T): string {
  return l.kind === 'league' && l.matchday
    ? t('league.matchday', { n: l.matchday })
    : t(`league.kind.${l.kind}`);
}

/** The club names and whether it is the user's game, as a league game needs them here. */
type LeagueRef = Pick<LeagueTag, 'home' | 'away' | 'mine'> & {
  kind: string;
  matchday: number | null;
};

/** A game of a league evening as a row: live when on the server, else its check-in. */
export function leagueItem(
  g: { id: string; phase: Phase; league: LeagueRef; server?: string; now?: NowMatch | null },
  t: T,
): LiveListItem {
  const link = ['/t', g.id];
  const label = leagueLabel(g.league, t);
  if (g.now) return nowItem(g.now, t, { key: g.id, label, link, mine: g.league.mine });
  return {
    key: g.id,
    label,
    names: [g.league.home, g.league.away],
    score: null,
    server: g.server ?? '',
    live: false,
    status: t(`phase.${g.phase}`),
    link,
    ...(g.league.mine ? { mine: true } : {}),
  };
}
