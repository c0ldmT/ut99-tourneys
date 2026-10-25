import { buildStructure, GF1, GF2, losersRoundSize, validateDefinition } from './structure.js';
import type {
  BracketDefinition,
  BracketIssue,
  BracketState,
  EntrantId,
  MatchId,
  MatchResult,
  MatchSource,
  MatchState,
  Standing,
} from './types.js';

export class InvalidBracketDefinitionError extends Error {
  constructor(public readonly errors: string[]) {
    super(`invalid bracket definition: ${errors.join('; ')}`);
    this.name = 'InvalidBracketDefinitionError';
  }
}

/**
 * Computes the full bracket state from a definition and the list of reported results.
 *
 * - Results are applied in order; a later result for the same match replaces an earlier one
 *   (this is how admin overrides work).
 * - Invalid or stale results never throw. They are ignored and listed in `issues`, so a
 *   corrected upstream result never leaves the bracket in a broken state.
 * - The function is deterministic: same input, same output, on website and bridge.
 */
export function computeBracket(
  definition: BracketDefinition,
  results: readonly MatchResult[],
): BracketState {
  const errors = validateDefinition(definition);
  if (errors.length) throw new InvalidBracketDefinitionError(errors);

  const nodes = buildStructure(
    definition.format,
    definition.size,
    definition.bestOf,
    definition.grandFinalReset,
  );
  const issues: BracketIssue[] = [];
  const known = new Set(nodes.map((n) => n.id));

  const latest = new Map<MatchId, MatchResult>();
  for (const r of results) {
    if (!known.has(r.matchId)) {
      issues.push({ matchId: r.matchId, code: 'unknown_match', message: `no match ${r.matchId}` });
      continue;
    }
    latest.set(r.matchId, r);
  }

  const byId: Record<MatchId, MatchState> = {};
  const matches: MatchState[] = [];

  const resolve = (src: MatchSource): EntrantId | null => {
    if (src.kind === 'slot') return definition.slots[src.slot] ?? null;
    const m = byId[src.matchId];
    if (!m || m.status !== 'completed') return null;
    return (src.kind === 'winner' ? m.winnerId : m.loserId) ?? null;
  };

  for (const node of nodes) {
    const state: MatchState = { ...node, entrants: [null, null], status: 'waiting' };
    byId[node.id] = state;
    matches.push(state);

    if (node.id === GF2) {
      const gf1 = byId[GF1] as MatchState;
      if (gf1.status !== 'completed') {
        dropResult(latest, node.id, issues, 'grand final not decided yet');
        continue;
      }
      // Winners-bracket champion sits in entrants[0] of GF1. If they won, no reset is needed.
      if (gf1.winnerId === gf1.entrants[0]) {
        state.status = 'void';
        dropResult(latest, node.id, issues, 'reset not needed: winners champion won grand final');
        continue;
      }
      state.entrants = [gf1.entrants[0], gf1.entrants[1]];
    } else {
      state.entrants = [resolve(node.sources[0]), resolve(node.sources[1])];
    }

    const [a, b] = state.entrants;
    if (a === null || b === null) {
      dropResult(latest, node.id, issues, 'entrants not determined yet');
      continue;
    }
    state.status = 'ready';

    const result = latest.get(node.id);
    if (!result) continue;
    const problem = checkResult(result, a, b, node.bestOf);
    if (problem) {
      issues.push({ matchId: node.id, ...problem });
      continue;
    }
    state.status = 'completed';
    state.result = result;
    state.winnerId = result.winnerId;
    state.loserId = result.winnerId === a ? b : a;
  }

  const championId = findChampion(definition, byId);
  // Fixtures have no champion: done when every pairing is decided.
  const done =
    definition.format === 'fixtures'
      ? matches.every((m) => m.status === 'completed')
      : !!championId;
  return {
    definition,
    matches,
    byId,
    status: done ? 'finished' : 'running',
    ...(championId ? { championId } : {}),
    standings: computeStandings(definition, matches, championId),
    issues,
  };
}

function dropResult(
  latest: Map<MatchId, MatchResult>,
  id: MatchId,
  issues: BracketIssue[],
  why: string,
): void {
  if (latest.has(id)) {
    issues.push({ matchId: id, code: 'not_ready', message: `result ignored: ${why}` });
    latest.delete(id);
  }
}

function checkResult(
  r: MatchResult,
  a: EntrantId,
  b: EntrantId,
  bestOf: number,
): Omit<BracketIssue, 'matchId'> | null {
  const [ra, rb] = r.entrants;
  const samePair = (ra === a && rb === b) || (ra === b && rb === a);
  if (!samePair) {
    return {
      code: 'stale_result',
      message: `result was reported for ${ra} vs ${rb}, but the match is now ${a} vs ${b}`,
    };
  }
  if (r.winnerId !== a && r.winnerId !== b) {
    return { code: 'invalid_winner', message: `winner ${r.winnerId} is not part of the match` };
  }
  if (r.games && r.games.length > 0 && (r.outcome === 'played' || r.outcome === 'simulated')) {
    const needed = Math.ceil(bestOf / 2);
    const loser = r.winnerId === a ? b : a;
    let wins = 0;
    let losses = 0;
    for (const g of r.games) {
      if (g.winnerId === r.winnerId) wins++;
      else if (g.winnerId === loser) losses++;
      else return { code: 'invalid_games', message: `game winner ${g.winnerId} not in match` };
    }
    if (r.games.length > bestOf || wins !== needed || losses >= needed) {
      return {
        code: 'invalid_games',
        message: `games ${wins}:${losses} do not decide a best of ${bestOf} for ${r.winnerId}`,
      };
    }
  }
  return null;
}

function findChampion(
  def: BracketDefinition,
  byId: Record<MatchId, MatchState>,
): EntrantId | undefined {
  if (def.format === 'fixtures') return undefined;
  if (def.format === 'single') {
    return byId[`W${Math.log2(def.size)}-1`]?.winnerId;
  }
  const gf1 = byId[GF1] as MatchState;
  if (gf1.status !== 'completed') return undefined;
  const gf2 = byId[GF2];
  if (!gf2 || gf2.status === 'void') return gf1.winnerId;
  return gf2.winnerId;
}

/**
 * Placement of everyone eliminated in a stage = (entrants still alive after that stage) + 1.
 * The number of eliminations per stage is fixed by the structure, so placements are final the
 * moment someone is eliminated.
 */
function computeStandings(
  def: BracketDefinition,
  matches: MatchState[],
  championId: EntrantId | undefined,
): Standing[] {
  const rounds = Math.log2(def.size);
  // stage key -> placement
  const placementByStage = new Map<string, number>();
  let eliminated = 0;
  if (def.format === 'fixtures') {
    // No placements: wins and losses only.
  } else if (def.format === 'single') {
    for (let r = 1; r <= rounds; r++) {
      eliminated += def.size / 2 ** r;
      placementByStage.set(`W${r}`, def.size - eliminated + 1);
    }
  } else {
    for (let j = 1; j <= 2 * (rounds - 1); j++) {
      eliminated += losersRoundSize(def.size, j);
      placementByStage.set(`L${j}`, def.size - eliminated + 1);
    }
    placementByStage.set('GF', 2);
  }

  const table = new Map<EntrantId, Standing>(
    def.slots.map((id) => [id, { entrantId: id, placement: null, wins: 0, losses: 0 }]),
  );

  for (const m of matches) {
    if (m.status !== 'completed' || !m.winnerId || !m.loserId) continue;
    (table.get(m.winnerId) as Standing).wins++;
    const loser = table.get(m.loserId) as Standing;
    loser.losses++;

    let stage: string | null = null;
    if (def.format === 'fixtures') stage = null;
    else if (def.format === 'single') stage = `W${m.round}`;
    else if (m.side === 'L') stage = `L${m.round}`;
    else if (m.id === GF2) stage = 'GF';
    else if (m.id === GF1) {
      // The winners champion losing GF1 only gets eliminated if there is no reset.
      const lbChampionLost = m.loserId === m.entrants[1];
      if (lbChampionLost || !def.grandFinalReset) stage = 'GF';
    }
    if (stage) {
      loser.placement = placementByStage.get(stage) as number;
      loser.eliminatedIn = m.id;
    }
  }
  if (championId) (table.get(championId) as Standing).placement = 1;

  const slotIndex = new Map(def.slots.map((id, i) => [id, i]));
  return [...table.values()].sort((x, y) => {
    if (x.placement !== y.placement) {
      if (x.placement === null) return -1;
      if (y.placement === null) return 1;
      return x.placement - y.placement;
    }
    if (x.wins !== y.wins) return y.wins - x.wins;
    if (x.losses !== y.losses) return x.losses - y.losses;
    return (slotIndex.get(x.entrantId) as number) - (slotIndex.get(y.entrantId) as number);
  });
}
