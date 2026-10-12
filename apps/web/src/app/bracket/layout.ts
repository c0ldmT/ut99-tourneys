import type { BracketState, MatchState } from '@tourney/bracket';
import { raceTime } from '../core/race';

/** Geometry of the bracket drawing (pure, testable without Angular). */
export const BOX_W = 180;
export const BOX_H = 52;
export const COL_GAP = 34;
export const ROW_GAP = 16;
export const SECTION_GAP = 56;
export const TITLE_H = 46;

export interface BoxLayout {
  match: MatchState;
  x: number;
  y: number;
}

export interface Connector {
  from: string;
  to: string;
  d: string;
}

export interface Section {
  side: 'W' | 'L' | 'GF';
  title: string;
  y: number;
}

export interface BracketLayout {
  width: number;
  height: number;
  boxes: BoxLayout[];
  connectors: Connector[];
  sections: Section[];
}

/**
 * Columns are rounds; a match sits at the vertical middle of the matches feeding it from the
 * same side, first-round matches (and losers-bracket matches fed only from the winners side)
 * are stacked from the top. The losers bracket goes below the winners bracket, the grand final
 * to the right of both.
 */
export function layoutBracket(
  state: BracketState,
  titles: { W: string; L: string; GF: string; SE: string },
): BracketLayout {
  const bySide = (side: MatchState['side']) => state.matches.filter((m) => m.side === side);
  const pos = new Map<string, { x: number; y: number }>();
  const boxes: BoxLayout[] = [];
  const sections: Section[] = [];
  const double = state.definition.format === 'double';

  const placeSide = (side: 'W' | 'L', top: number): number => {
    const matches = bySide(side);
    if (!matches.length) return top;
    const rounds = Math.max(...matches.map((m) => m.round));
    let bottom = top;
    for (let r = 1; r <= rounds; r++) {
      const inRound = matches.filter((m) => m.round === r).sort((a, b) => a.index - b.index);
      let nextFree = top;
      for (const m of inRound) {
        const feeders = m.sources
          .filter((s) => s.kind === 'winner')
          .map((s) => (s.kind === 'winner' ? state.byId[s.matchId] : undefined))
          .filter((f): f is MatchState => !!f && f.side === side)
          .map((f) => pos.get(f.id))
          .filter((p): p is { x: number; y: number } => !!p);
        let y = feeders.length ? feeders.reduce((a, p) => a + p.y, 0) / feeders.length : nextFree;
        y = Math.max(y, nextFree);
        const x = (r - 1) * (BOX_W + COL_GAP);
        pos.set(m.id, { x, y });
        boxes.push({ match: m, x, y });
        nextFree = y + BOX_H + ROW_GAP;
        bottom = Math.max(bottom, y + BOX_H);
      }
    }
    return bottom;
  };

  const wTop = TITLE_H;
  sections.push({ side: 'W', title: double ? titles.W : titles.SE, y: 0 });
  const wBottom = placeSide('W', wTop);
  let bottom = wBottom;
  if (double) {
    const lTitle = wBottom + SECTION_GAP;
    sections.push({ side: 'L', title: titles.L, y: lTitle });
    bottom = placeSide('L', lTitle + TITLE_H);
  }

  const maxX = boxes.reduce((a, b) => Math.max(a, b.x), 0);
  const gf = bySide('GF').sort((a, b) => a.round - b.round);
  if (gf.length) {
    const wFinal = bySide('W').reduce<MatchState | undefined>(
      (a, m) => (!a || m.round > a.round ? m : a),
      undefined,
    );
    const anchor = wFinal ? pos.get(wFinal.id) : undefined;
    const y = anchor ? anchor.y : wTop;
    sections.push({ side: 'GF', title: titles.GF, y: Math.max(0, y - TITLE_H) });
    gf.forEach((m, i) => {
      const x = maxX + (i + 1) * (BOX_W + COL_GAP);
      pos.set(m.id, { x, y });
      boxes.push({ match: m, x, y });
    });
  }

  const connectors: Connector[] = [];
  for (const b of boxes) {
    for (const s of b.match.sources) {
      if (s.kind !== 'winner') continue;
      const from = state.byId[s.matchId];
      const p = pos.get(s.matchId);
      if (!from || !p) continue;
      // Losers bracket champion -> grand final crosses sections; draw it too.
      if (from.side !== b.match.side && b.match.side !== 'GF') continue;
      const x1 = p.x + BOX_W;
      const y1 = p.y + BOX_H / 2;
      const x2 = b.x;
      const y2 = b.y + BOX_H / 2;
      const mid = x1 + Math.max(12, (x2 - x1) / 2);
      connectors.push({ from: from.id, to: b.match.id, d: `M${x1},${y1} H${mid} V${y2} H${x2}` });
    }
  }

  const width = boxes.reduce((a, b) => Math.max(a, b.x + BOX_W), 0) + 8;
  const height = Math.max(bottom, ...boxes.map((b) => b.y + BOX_H)) + 8;
  return { width, height, boxes, connectors, sections };
}

/** What a match box shows next to each name: frags for a single game, games won in a series. */
export function matchScore(
  m: MatchState,
  /** Finished games of this match so far (projection.games[m.id]). */
  played: readonly { winnerId: string; scores: Record<string, number> }[],
  live?: {
    matchId: string;
    scores?: Record<string, number>;
    race?: { runner: string; timeMs: number; penaltyMs: number };
  } | null,
  /** Monster Hunt: game scores are final times in ms. */
  race = false,
): [string, string] {
  const [a, b] = m.entrants;
  if (!a || !b) return ['', ''];
  const games = m.result?.games?.length ? m.result.games : played;
  const wins = (id: string) => games.filter((g) => g.winnerId === id).length;
  if (race) {
    const r = live && live.matchId === m.id && m.status !== 'completed' ? live.race : undefined;
    if (r) {
      const t = (id: string) =>
        id === r.runner ? `▶ ${raceTime(r.timeMs + r.penaltyMs, false)}` : '';
      return m.bestOf > 1 ? [`${wins(a)} ${t(a)}`, `${wins(b)} ${t(b)}`] : [t(a), t(b)];
    }
    if (m.bestOf === 1 && games.length === 1) {
      const g = games[0]!;
      const t = (id: string) => (g.scores[id] === undefined ? '' : raceTime(g.scores[id]!, false));
      return [t(a), t(b)];
    }
  }
  const running = live && live.matchId === m.id && live.scores && m.status !== 'completed';
  if (running) {
    const la = live.scores![a] ?? 0;
    const lb = live.scores![b] ?? 0;
    return m.bestOf > 1 ? [`${wins(a)} (${la})`, `${wins(b)} (${lb})`] : [String(la), String(lb)];
  }
  if (m.result?.outcome === 'forfeit' && !games.length) {
    return m.result.winnerId === a ? ['W', 'FF'] : ['FF', 'W'];
  }
  if (m.bestOf === 1 && games.length === 1) {
    const g = games[0]!;
    return [String(g.scores[a] ?? ''), String(g.scores[b] ?? '')];
  }
  if (games.length) return [String(wins(a)), String(wins(b))];
  if (m.result) return m.result.winnerId === a ? ['1', '0'] : ['0', '1'];
  return ['', ''];
}
