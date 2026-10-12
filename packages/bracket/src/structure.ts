import type {
  BestOfPolicy,
  BracketDefinition,
  BracketFormat,
  BracketSize,
  MatchId,
  MatchNode,
  MatchSource,
  MatchStage,
} from './types.js';
import { BRACKET_SIZES } from './types.js';

export const matchId = (side: 'W' | 'L', round: number, index: number): MatchId =>
  `${side}${round}-${index}`;
export const GF1: MatchId = 'GF1';
export const GF2: MatchId = 'GF2';

const log2 = (n: number) => Math.round(Math.log2(n));

/**
 * Order in which the losers of a winners round drop into the losers bracket.
 * Alternating "reverse" and "swap halves" keeps players from meeting the same opponent
 * again soon after dropping down.
 * Returns perm such that losers-bracket match i receives the loser of winners match perm[i].
 */
export function dropInOrder(winnersRound: number, matchCount: number): number[] {
  const identity = Array.from({ length: matchCount }, (_, i) => i + 1);
  if (matchCount === 1) return identity;
  if ((winnersRound - 2) % 2 === 0) return identity.reverse();
  const half = matchCount / 2;
  return [...identity.slice(half), ...identity.slice(0, half)];
}

/** Number of matches in losers round j (1-based) of a double elimination bracket of `size`. */
export function losersRoundSize(size: number, round: number): number {
  if (round === 1) return size / 4;
  const m = Math.floor(round / 2);
  return round % 2 === 0 ? size / 2 ** (m + 1) : size / 2 ** (m + 2);
}

function bestOfFor(policy: BestOfPolicy, stage: MatchStage | null): number {
  switch (stage) {
    case 'semifinal':
      return policy.semifinal ?? policy.default;
    case 'final':
      return policy.final ?? policy.default;
    case 'lbFinal':
      return policy.lbFinal ?? policy.default;
    case 'grandFinal':
    case 'grandFinalReset':
      return policy.grandFinal ?? policy.default;
    default:
      return policy.default;
  }
}

interface RawNode {
  id: MatchId;
  side: MatchNode['side'];
  round: number;
  index: number;
  stage: MatchStage | null;
  sources: [MatchSource, MatchSource];
}

/** Generates the static match graph (without results) for a format and size. */
export function buildStructure(
  format: BracketFormat,
  size: BracketSize,
  bestOf: BestOfPolicy,
  grandFinalReset: boolean,
): MatchNode[] {
  const rounds = log2(size);
  const raw: RawNode[] = [];

  // Winners bracket (= the whole bracket for single elimination).
  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    for (let i = 1; i <= count; i++) {
      const sources: [MatchSource, MatchSource] =
        r === 1
          ? [
              { kind: 'slot', slot: 2 * i - 2 },
              { kind: 'slot', slot: 2 * i - 1 },
            ]
          : [
              { kind: 'winner', matchId: matchId('W', r - 1, 2 * i - 1) },
              { kind: 'winner', matchId: matchId('W', r - 1, 2 * i) },
            ];
      const stage: MatchStage | null =
        r === rounds ? 'final' : r === rounds - 1 ? 'semifinal' : null;
      raw.push({ id: matchId('W', r, i), side: 'W', round: r, index: i, stage, sources });
    }
  }

  if (format === 'double') {
    const lbRounds = 2 * (rounds - 1);
    for (let j = 1; j <= lbRounds; j++) {
      const count = losersRoundSize(size, j);
      const perm = j % 2 === 0 ? dropInOrder(j / 2 + 1, count) : [];
      for (let i = 1; i <= count; i++) {
        let sources: [MatchSource, MatchSource];
        if (j === 1) {
          sources = [
            { kind: 'loser', matchId: matchId('W', 1, 2 * i - 1) },
            { kind: 'loser', matchId: matchId('W', 1, 2 * i) },
          ];
        } else if (j % 2 === 0) {
          // Survivor of the previous losers round meets a player dropping from winners round j/2+1.
          sources = [
            { kind: 'winner', matchId: matchId('L', j - 1, i) },
            { kind: 'loser', matchId: matchId('W', j / 2 + 1, perm[i - 1] as number) },
          ];
        } else {
          sources = [
            { kind: 'winner', matchId: matchId('L', j - 1, 2 * i - 1) },
            { kind: 'winner', matchId: matchId('L', j - 1, 2 * i) },
          ];
        }
        raw.push({
          id: matchId('L', j, i),
          side: 'L',
          round: j,
          index: i,
          stage: j === lbRounds ? 'lbFinal' : null,
          sources,
        });
      }
    }
    raw.push({
      id: GF1,
      side: 'GF',
      round: 1,
      index: 1,
      stage: 'grandFinal',
      sources: [
        { kind: 'winner', matchId: matchId('W', rounds, 1) },
        { kind: 'winner', matchId: matchId('L', lbRounds, 1) },
      ],
    });
    if (grandFinalReset) {
      raw.push({
        id: GF2,
        side: 'GF',
        round: 2,
        index: 1,
        stage: 'grandFinalReset',
        // GF2 keeps the GF1 pairing; which entrant sits where is resolved by the engine.
        sources: [
          { kind: 'winner', matchId: GF1 },
          { kind: 'loser', matchId: GF1 },
        ],
      });
    }
  }

  // Depth = longest chain of matches before this one.
  const depth = new Map<MatchId, number>();
  for (const node of raw) {
    const d = node.sources.map((s) => (s.kind === 'slot' ? -1 : (depth.get(s.matchId) ?? -1)));
    depth.set(node.id, Math.max(...d) + 1);
  }

  // Height = longest chain of matches after this one (reverse topological pass).
  const height = new Map<MatchId, number>(raw.map((n) => [n.id, 0]));
  for (const node of [...raw].reverse()) {
    for (const s of node.sources) {
      if (s.kind === 'slot') continue;
      const h = (height.get(node.id) as number) + 1;
      if (h > (height.get(s.matchId) as number)) height.set(s.matchId, h);
    }
  }

  return raw.map((node) => ({
    ...node,
    depth: depth.get(node.id) as number,
    height: height.get(node.id) as number,
    bestOf: bestOfFor(bestOf, node.stage),
  }));
}

export function validateDefinition(def: BracketDefinition): string[] {
  const errors: string[] = [];
  if (!(BRACKET_SIZES as readonly number[]).includes(def.size))
    errors.push(`unsupported size ${def.size}`);
  if (def.format !== 'single' && def.format !== 'double')
    errors.push(`unknown format ${def.format}`);
  if (def.slots.length !== def.size)
    errors.push(`expected ${def.size} slots, got ${def.slots.length}`);
  const dupes = def.slots.filter((s, i) => def.slots.indexOf(s) !== i);
  if (dupes.length) errors.push(`duplicate entrants: ${[...new Set(dupes)].join(', ')}`);
  if (def.slots.some((s) => typeof s !== 'string' || s.length === 0)) errors.push('empty slot id');
  const bo = def.bestOf;
  for (const [key, value] of Object.entries(bo)) {
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 1 || value > 7 || value % 2 === 0) {
      errors.push(`bestOf.${key} must be 1, 3, 5 or 7`);
    }
  }
  return errors;
}
