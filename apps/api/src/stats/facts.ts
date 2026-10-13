import { ADAPTER_MH, finalMs, parseRules } from '@tourney/adapter-ut99';
import {
  teamStarters,
  type Entrant,
  type PlayerGameStats,
  type TournamentEvent,
  type TournamentSettings,
} from '@tourney/protocol';

/**
 * Statistics facts of one tournament, derived from its event log (pure, no database).
 *
 * The website's statistics are a read model of the event logs: facts per tournament are cached
 * and aggregated on request (see aggregate.ts). A rating system (Elo) can later consume the same
 * facts in time order (`MatchFact.at`) without new data sources.
 *
 * Only games that were really played on the server count (a `match.started` for the game);
 * simulated bot matches and forfeits without a game do not.
 */

export type StatMode = 'dm' | 'tdm' | 'mh';

export interface PlayerRef {
  /** `u:<user id>` for website users, `b:<bot name, lower case>` for bots. */
  key: string;
  name: string;
  userId?: string;
  bot: boolean;
}

export interface GameFact {
  matchId: string;
  game: number;
  map: string;
  at: string;
  entrants: [string, string];
  winnerEntrantId: string;
  endReason: string;
  /** Seconds from the start to the end (from the player statistics; Monster Hunt: undefined). */
  durationSec?: number;
}

export interface PlayerGameFact extends PlayerRef {
  matchId: string;
  game: number;
  /** Monster Hunt: run 1 or 2; 0 otherwise. */
  run: number;
  entrantId: string;
  won: boolean;
  map: string;
  at: string;
  /** Counted by the mod (mod 0.6.0 and newer); undefined for older games. */
  stats?: PlayerGameStats;
}

export interface RunFact {
  matchId: string;
  game: number;
  run: number;
  entrantId: string;
  entrantName: string;
  map: string;
  at: string;
  timeMs: number;
  deaths: number;
  penaltyMs: number;
  /** Time plus penalty: what decides the race and the map records. */
  finalMs: number;
  points: number;
  finished: boolean;
  forfeit: boolean;
  monsterSkill: number;
  penaltySec: number;
  lives: number;
  members: PlayerRef[];
  /** The team had at least one human. */
  hasHuman: boolean;
}

export interface MatchFact {
  matchId: string;
  at: string;
  entrants: [string, string];
  winnerEntrantId: string;
  outcome: string;
  players: { ref: PlayerRef; entrantId: string; won: boolean }[];
}

export interface TournamentFacts {
  tournamentId: string;
  name: string;
  mode: StatMode;
  at: string;
  finished: boolean;
  championEntrantId?: string;
  entrantNames: Record<string, string>;
  games: GameFact[];
  players: PlayerGameFact[];
  runs: RunFact[];
  matches: MatchFact[];
  /** Players who played at least one game; `champion` for those who played for the winner. */
  participants: { ref: PlayerRef; champion: boolean }[];
}

/** Monster Hunt settings of the tournament (defaults like the adapter's when the rules are partial). */
function gameRules(settings: TournamentSettings): {
  monsterSkill: number;
  penaltySec: number;
  lives: number;
} {
  let r: Record<string, unknown> = settings.game.rules;
  try {
    r = parseRules(settings.game.rules) as unknown as Record<string, unknown>;
  } catch {
    // older or partial rules: read what is there
  }
  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
  return {
    monsterSkill: num(r['monsterSkill'], 5),
    penaltySec: num(r['penaltySec'], 5),
    lives: num(r['lives'], 0),
  };
}

export function statMode(settings: TournamentSettings): StatMode {
  if (settings.game.adapter === ADAPTER_MH) return 'mh';
  return settings.teamSize > 1 ? 'tdm' : 'dm';
}

export const userKey = (userId: string) => `u:${userId}`;
export const botKey = (name: string) => `b:${name.toLowerCase()}`;

const userRef = (userId: string, name: string): PlayerRef => ({
  key: userKey(userId),
  name,
  userId,
  bot: false,
});
const botRef = (name: string): PlayerRef => ({ key: botKey(name), name, bot: true });

/** Who plays for an entrant when the log has no line-up (1v1, older logs). */
function entrantPlayers(e: Entrant | undefined, teamSize: number): PlayerRef[] {
  if (!e) return [];
  if (e.kind === 'human') return [userRef(e.userId, e.displayName)];
  if (e.kind === 'bot') return [botRef(e.bot.name)];
  const starters = teamStarters(e, teamSize).map((m) => userRef(m.userId, m.displayName));
  const bots = e.bots.slice(0, Math.max(0, teamSize - starters.length)).map((b) => botRef(b.name));
  return [...starters, ...bots];
}

type Lineup = { name: string; userId?: string; bot?: boolean }[];

const lineupRefs = (l: Lineup): PlayerRef[] =>
  l.map((x) => (x.userId ? userRef(x.userId, x.name) : botRef(x.name)));

const refOf = (p: PlayerRef): PlayerRef => ({
  key: p.key,
  name: p.name,
  ...(p.userId ? { userId: p.userId } : {}),
  bot: p.bot,
});

const statRef = (p: PlayerGameStats): PlayerRef =>
  p.userId ? userRef(p.userId, p.name) : botRef(p.name);

export function extractFacts(
  t: { id: string; name: string; settings: TournamentSettings },
  events: readonly TournamentEvent[],
): TournamentFacts {
  const mode = statMode(t.settings);
  const teamSize = t.settings.teamSize;
  const rules = gameRules(t.settings);
  const entrants: Record<string, Entrant> = {};
  /** match/game/run -> line-ups (team games) and start time; marks a game as really played. */
  const started = new Map<string, { lineups?: Record<string, Lineup>; runner?: string }>();
  const stats = new Map<string, { players: PlayerGameStats[]; durationSec: number }>();
  const runsDone = new Map<string, number>();
  const results = new Map<string, { winnerId: string; outcome: string; at: string }>();
  const facts: TournamentFacts = {
    tournamentId: t.id,
    name: t.name,
    mode,
    at: events.at(-1)?.at ?? '',
    finished: false,
    entrantNames: {},
    games: [],
    players: [],
    runs: [],
    matches: [],
    participants: [],
  };
  const gk = (m: string, g: number, run = 0) => `${m}/${g}/${run}`;

  /** Players of an entrant in a game (run): statistics first, then line-up, then the entrant. */
  const playersOf = (
    matchId: string,
    game: number,
    run: number,
    entrantId: string,
  ): PlayerRef[] => {
    const st = stats.get(gk(matchId, game, run));
    const fromStats = st?.players.filter((p) => p.entrantId === entrantId).map(statRef) ?? [];
    if (fromStats.length) return fromStats;
    const lineup = started.get(gk(matchId, game, run))?.lineups?.[entrantId];
    if (lineup?.length) return lineupRefs(lineup);
    return entrantPlayers(entrants[entrantId], teamSize);
  };

  const addPlayerGames = (
    matchId: string,
    game: number,
    run: number,
    entrantId: string,
    won: boolean,
    map: string,
    at: string,
  ) => {
    const st = stats.get(gk(matchId, game, run));
    for (const ref of playersOf(matchId, game, run, entrantId)) {
      const s = st?.players.find((p) => statRef(p).key === ref.key && p.entrantId === entrantId);
      facts.players.push({
        ...ref,
        matchId,
        game,
        run,
        entrantId,
        won,
        map,
        at,
        ...(s ? { stats: s } : {}),
      });
    }
  };

  for (const e of events) {
    switch (e.type) {
      case 'seeding.set':
        for (const en of e.data.entrants) entrants[en.id] = en;
        break;
      case 'entrant.replaced':
        entrants[e.data.entrantId] = { ...e.data.replacement, id: e.data.entrantId } as Entrant;
        break;
      case 'match.started': {
        const run = e.data.runner ? (runsDone.get(gk(e.data.matchId, e.data.game)) ?? 0) + 1 : 0;
        started.set(gk(e.data.matchId, e.data.game, run), {
          ...(e.data.lineups ? { lineups: e.data.lineups } : {}),
          ...(e.data.runner ? { runner: e.data.runner } : {}),
        });
        break;
      }
      case 'match.playerStats':
        stats.set(gk(e.data.matchId, e.data.game, e.data.run ?? 0), {
          players: e.data.players,
          durationSec: e.data.durationSec,
        });
        break;
      case 'match.runFinished': {
        const d = e.data;
        const key = gk(d.matchId, d.game);
        const run = (runsDone.get(key) ?? 0) + 1;
        runsDone.set(key, run);
        if (!started.has(gk(d.matchId, d.game, run))) break; // not played on the server
        const members = playersOf(d.matchId, d.game, run, d.entrantId);
        facts.runs.push({
          matchId: d.matchId,
          game: d.game,
          run,
          entrantId: d.entrantId,
          entrantName: entrants[d.entrantId]?.displayName ?? d.entrantId,
          map: d.map,
          at: e.at,
          timeMs: d.timeMs,
          deaths: d.deaths,
          penaltyMs: d.penaltyMs,
          finalMs: finalMs(d),
          points: d.points,
          finished: d.finished,
          forfeit: d.forfeit ?? false,
          monsterSkill: rules.monsterSkill,
          penaltySec: rules.penaltySec,
          lives: rules.lives,
          members,
          hasHuman: members.some((m) => !m.bot),
        });
        break;
      }
      case 'match.gameFinished': {
        const d = e.data;
        const cm = Object.keys(d.scores) as [string, string];
        if (mode === 'mh') {
          const runs = facts.runs.filter((r) => r.matchId === d.matchId && r.game === d.game);
          if (!runs.length) break;
          facts.games.push({
            matchId: d.matchId,
            game: d.game,
            map: d.map,
            at: e.at,
            entrants: cm,
            winnerEntrantId: d.winnerId,
            endReason: d.endReason,
          });
          for (const r of runs)
            addPlayerGames(
              d.matchId,
              d.game,
              r.run,
              r.entrantId,
              r.entrantId === d.winnerId,
              d.map,
              e.at,
            );
          break;
        }
        if (!started.has(gk(d.matchId, d.game))) break; // simulated
        const st = stats.get(gk(d.matchId, d.game));
        facts.games.push({
          matchId: d.matchId,
          game: d.game,
          map: d.map,
          at: e.at,
          entrants: cm,
          winnerEntrantId: d.winnerId,
          endReason: d.endReason,
          ...(st ? { durationSec: st.durationSec } : {}),
        });
        for (const id of cm)
          addPlayerGames(d.matchId, d.game, 0, id, id === d.winnerId, d.map, e.at);
        break;
      }
      case 'match.result':
        results.set(e.data.result.matchId, {
          winnerId: e.data.result.winnerId,
          outcome: e.data.result.outcome,
          at: e.at,
        });
        break;
      case 'tournament.finished':
        facts.finished = true;
        facts.championEntrantId = e.data.championId;
        break;
      default:
        break;
    }
  }

  // Matches with at least one real game, decided by their last result (an override wins).
  const byMatch = new Map<string, PlayerGameFact[]>();
  for (const p of facts.players) byMatch.set(p.matchId, [...(byMatch.get(p.matchId) ?? []), p]);
  for (const [matchId, rows] of byMatch) {
    const r = results.get(matchId);
    if (!r) continue; // still running
    const game = facts.games.find((g) => g.matchId === matchId);
    const seen = new Map<string, { ref: PlayerRef; entrantId: string; won: boolean }>();
    for (const p of rows) {
      if (seen.has(p.key)) continue;
      seen.set(p.key, { ref: refOf(p), entrantId: p.entrantId, won: p.entrantId === r.winnerId });
    }
    facts.matches.push({
      matchId,
      at: r.at,
      entrants: game?.entrants ?? ['', ''],
      winnerEntrantId: r.winnerId,
      outcome: r.outcome,
      players: [...seen.values()],
    });
  }
  facts.matches.sort((a, b) => a.at.localeCompare(b.at));

  const part = new Map<string, { ref: PlayerRef; champion: boolean }>();
  for (const p of facts.players) {
    const champion =
      (part.get(p.key)?.champion ?? false) || p.entrantId === facts.championEntrantId;
    part.set(p.key, { ref: refOf(p), champion });
  }
  facts.participants = [...part.values()];
  for (const [id, en] of Object.entries(entrants)) facts.entrantNames[id] = en.displayName;
  return facts;
}
