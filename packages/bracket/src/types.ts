/**
 * Core types of the bracket engine.
 *
 * The engine is a pure function: (definition, results) -> state. It knows nothing about
 * games, servers or users. An "entrant" is a stable bracket position holder; who occupies it
 * (a human or a bot that replaced a no-show) is tracked outside of the engine.
 */

export type EntrantId = string;
export type MatchId = string;

export type BracketFormat = 'single' | 'double';
export const BRACKET_SIZES = [4, 8, 16, 32] as const;
export type BracketSize = (typeof BRACKET_SIZES)[number];

/** W = winners bracket (also used for single elimination), L = losers bracket, GF = grand final. */
export type BracketSide = 'W' | 'L' | 'GF';

/** Notable matches, used for best-of policies and for display. */
export type MatchStage = 'semifinal' | 'final' | 'lbFinal' | 'grandFinal' | 'grandFinalReset';

/** Number of games per match. Odd values only (1, 3, 5, 7). */
export interface BestOfPolicy {
  default: number;
  /** Semifinals of the (winners) bracket. */
  semifinal?: number;
  /** Final in single elimination, winners final in double elimination. */
  final?: number;
  /** Final of the losers bracket (double elimination only). */
  lbFinal?: number;
  /** Grand final and its reset (double elimination only). */
  grandFinal?: number;
}

export interface BracketDefinition {
  format: BracketFormat;
  size: BracketSize;
  /**
   * Entrants in first-round slot order: match W1-n is slots[2n-2] vs slots[2n-1].
   * Must contain exactly `size` unique ids. Empty slots are filled with bots before
   * the definition is created (see seeding helpers).
   */
  slots: EntrantId[];
  /** Double elimination: play a second grand final if the losers-bracket champion wins the first. */
  grandFinalReset: boolean;
  bestOf: BestOfPolicy;
}

export type MatchSource =
  | { kind: 'slot'; slot: number }
  | { kind: 'winner'; matchId: MatchId }
  | { kind: 'loser'; matchId: MatchId };

export interface MatchNode {
  id: MatchId;
  side: BracketSide;
  /** 1-based round within its side. */
  round: number;
  /** 1-based position within its round. */
  index: number;
  /** Longest dependency chain to the first round (first round = 0). Used for scheduling. */
  depth: number;
  /** Longest chain of matches that still follow this one (critical path). Used for scheduling. */
  height: number;
  stage: MatchStage | null;
  bestOf: number;
  sources: [MatchSource, MatchSource];
}

export interface GameResult {
  map?: string;
  scores: Record<EntrantId, number>;
  winnerId: EntrantId;
}

export type ResultOutcome =
  /** Match was played normally. */
  | 'played'
  /** Loser did not show up / disconnected beyond the grace period. */
  | 'forfeit'
  /** Bot vs bot match resolved without playing. */
  | 'simulated'
  /** Result set or corrected by an admin. */
  | 'override';

export interface MatchResult {
  matchId: MatchId;
  /** The pairing the result was reported for. Used to detect results made stale by overrides. */
  entrants: [EntrantId, EntrantId];
  winnerId: EntrantId;
  outcome: ResultOutcome;
  games?: GameResult[];
}

export type MatchStatus =
  /** At least one entrant is not determined yet. */
  | 'waiting'
  /** Both entrants known, no result yet. */
  | 'ready'
  | 'completed'
  /** Will never be played (grand final reset that is not needed). */
  | 'void';

export interface MatchState extends MatchNode {
  entrants: [EntrantId | null, EntrantId | null];
  status: MatchStatus;
  result?: MatchResult;
  winnerId?: EntrantId;
  loserId?: EntrantId;
}

export interface Standing {
  entrantId: EntrantId;
  /** Final placement (ties share the best placement, e.g. 3, 3, 5, 5, 5, 5). null while still in the tournament. */
  placement: number | null;
  wins: number;
  losses: number;
  eliminatedIn?: MatchId;
}

export type BracketIssueCode =
  'unknown_match' | 'not_ready' | 'stale_result' | 'invalid_winner' | 'invalid_games';

export interface BracketIssue {
  matchId: MatchId;
  code: BracketIssueCode;
  message: string;
}

export interface BracketState {
  definition: BracketDefinition;
  /** All matches in a stable topological order. */
  matches: MatchState[];
  byId: Record<MatchId, MatchState>;
  status: 'running' | 'finished';
  championId?: EntrantId;
  /** One entry per entrant, sorted by placement (still active first, by wins). */
  standings: Standing[];
  /** Results that were ignored, with the reason. Never throws for bad results. */
  issues: BracketIssue[];
}
