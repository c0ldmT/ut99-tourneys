import type {
  Entrant,
  PlayerGameStats,
  RunRecord,
  TournamentEvent,
  TournamentProjection,
} from '@tourney/protocol';

/**
 * Match page (pure): the two entrants, every game of the series with map, score and the
 * statistics of each player (Monster Hunt: per run), from the event log. Games of an earlier
 * call of the match (made void by an organizer) are left out.
 */

export interface MatchSide {
  id: string;
  name: string;
  kind: Entrant['kind'];
  tag?: string;
  /** Rating at the seeding (player, bot or team average). */
  rating?: number;
  /** Website users of the side (players, team members). */
  members: { userId: string; name: string; sub?: boolean }[];
  /** Bots of the side; `id` for bots of the control center. */
  bots: { id?: string; name: string }[];
}

export interface MatchPlayer extends Omit<PlayerGameStats, 'entrantId'> {
  entrantId: string;
  /** Control center bot (profile link). */
  botId?: string;
  /** Monster Hunt: 1 or 2. */
  run?: number;
}

export interface MatchGame {
  game: number;
  map?: string;
  scores?: Record<string, number>;
  winnerId?: string;
  endReason?: string;
  durationSec?: number;
  /** Monster Hunt race: both runs. */
  runs?: RunRecord[];
  players: MatchPlayer[];
  /** Played right now (no result yet). */
  live?: boolean;
}

export interface MatchDetail {
  matchId: string;
  status: string;
  bestOf: number;
  side: string;
  round: number;
  winnerId?: string;
  outcome?: string;
  entrants: MatchSide[];
  games: MatchGame[];
  /** Series score: games won per entrant. */
  wins: Record<string, number>;
}

function side(id: string, proj: TournamentProjection): MatchSide {
  const e = proj.entrants[id];
  const rating = proj.seedRatings?.[id];
  const base = {
    id,
    name: e?.displayName ?? id,
    kind: e?.kind ?? ('human' as const),
    ...(rating !== undefined ? { rating } : {}),
  };
  if (e?.kind === 'human')
    return { ...base, members: [{ userId: e.userId, name: e.displayName }], bots: [] };
  if (e?.kind === 'bot')
    return {
      ...base,
      members: [],
      bots: [{ ...(e.bot.id ? { id: e.bot.id } : {}), name: e.bot.name }],
    };
  if (e?.kind === 'team')
    return {
      ...base,
      ...(e.tag ? { tag: e.tag } : {}),
      members: e.members.map((m) => ({
        userId: m.userId,
        name: m.displayName,
        ...(m.sub ? { sub: true } : {}),
      })),
      bots: e.bots.map((b) => ({ ...(b.id ? { id: b.id } : {}), name: b.name })),
    };
  return { ...base, members: [], bots: [] };
}

export function matchDetail(
  events: readonly TournamentEvent[],
  proj: TournamentProjection,
  matchId: string,
): MatchDetail | undefined {
  const node = proj.bracket?.byId[matchId];
  if (!node) return undefined;
  const [a, b] = node.entrants;
  const entrants = [a, b].filter((x): x is string => !!x).map((id) => side(id, proj));
  // Bots of the control center by name in the game (statistics report names).
  const botIds = new Map<string, string>();
  for (const s of entrants)
    for (const x of s.bots) if (x.id) botIds.set(x.name.slice(0, 24).toLowerCase(), x.id);
  // Only the events after the last call of the match count.
  let from = 0;
  events.forEach((e, i) => {
    if (e.type === 'match.called' && e.data.matchId === matchId) from = i;
  });
  const games = new Map<number, MatchGame>();
  const game = (n: number) => {
    let g = games.get(n);
    if (!g) games.set(n, (g = { game: n, players: [] }));
    return g;
  };
  for (const e of events.slice(from)) {
    if (!('data' in e) || (e.data as { matchId?: string }).matchId !== matchId) continue;
    if (e.type === 'match.mapSelected') game(e.data.game).map = e.data.map;
    else if (e.type === 'match.started') {
      const g = game(e.data.game);
      g.live = true;
    } else if (e.type === 'match.playerStats') {
      const g = game(e.data.game);
      g.map ??= e.data.map;
      g.durationSec = (g.durationSec ?? 0) + e.data.durationSec;
      for (const p of e.data.players) {
        if (!p.entrantId) continue;
        const botId = p.bot ? botIds.get(p.name.slice(0, 24).toLowerCase()) : undefined;
        g.players.push({
          ...p,
          entrantId: p.entrantId,
          ...(botId ? { botId } : {}),
          ...(e.data.run ? { run: e.data.run } : {}),
        });
      }
    } else if (e.type === 'match.runFinished') {
      const g = game(e.data.game);
      const { matchId: _m, game: _g, ...run } = e.data;
      g.runs = [...(g.runs ?? []), run];
    } else if (e.type === 'match.gameFinished') {
      const g = game(e.data.game);
      g.map = e.data.map;
      g.scores = e.data.scores;
      g.winnerId = e.data.winnerId;
      g.endReason = e.data.endReason;
      delete g.live;
    }
  }
  // A game in progress only while the match is the current one.
  if (proj.currentMatch?.matchId !== matchId) for (const g of games.values()) delete g.live;
  const list = [...games.values()].sort((x, y) => x.game - y.game);
  const wins: Record<string, number> = {};
  for (const s of entrants) wins[s.id] = 0;
  for (const g of list) if (g.winnerId && g.winnerId in wins) wins[g.winnerId]!++;
  return {
    matchId,
    status: node.status,
    bestOf: node.bestOf,
    side: node.side,
    round: node.round,
    ...(node.winnerId ? { winnerId: node.winnerId } : {}),
    ...(node.result?.outcome ? { outcome: node.result.outcome } : {}),
    entrants,
    games: list,
    wins,
  };
}
