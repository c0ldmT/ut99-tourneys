/** The lineups of a Dream Team roster: bot ids per slot (5 per mode) and the shared bench (2). */
export interface LineupDraft {
  dm: (string | null)[];
  mh: (string | null)[];
  bench: (string | null)[];
}

export type LineupMode = 'dm' | 'mh';

/** A place a bot can be put: a slot of the mode, a bench place, or out of the lineup. */
export type LineupPos =
  { kind: 'slot'; i: number } | { kind: 'bench'; i: number } | { kind: 'out' };

const SLOTS = 5;
const BENCH = 2;

function filled(list: readonly (string | null)[], n: number): (string | null)[] {
  return Array.from({ length: n }, (_, i) => list[i] ?? null);
}

/** Where a bot stands in the mode's lineup (slot before bench), or out. */
export function positionOf(d: LineupDraft, mode: LineupMode, botId: string): LineupPos {
  const s = d[mode].indexOf(botId);
  if (s >= 0) return { kind: 'slot', i: s };
  const b = d.bench.indexOf(botId);
  if (b >= 0) return { kind: 'bench', i: b };
  return { kind: 'out' };
}

/**
 * Puts a bot on a place of the mode's lineup. A bot already there swaps with it (it takes the
 * moved bot's old place, or leaves the lineup when the moved bot came from outside). A bot is in
 * the slots or on the bench of a mode, not both; the other mode's slots stay as they are.
 */
export function placeBot(
  d: LineupDraft,
  mode: LineupMode,
  botId: string,
  to: LineupPos,
  /** The place the bot was taken from, if known (a bench bot may also hold a slot). */
  taken?: LineupPos,
): LineupDraft {
  const next: LineupDraft = {
    dm: filled(d.dm, SLOTS),
    mh: filled(d.mh, SLOTS),
    bench: filled(d.bench, BENCH),
  };
  const slots = next[mode];
  const at = (p: LineupPos): string | null =>
    p.kind === 'slot' ? slots[p.i]! : p.kind === 'bench' ? next.bench[p.i]! : null;
  const from = taken && at(taken) === botId ? taken : positionOf(next, mode, botId);
  const set = (p: LineupPos, id: string | null) => {
    if (p.kind === 'slot') slots[p.i] = id;
    else if (p.kind === 'bench') next.bench[p.i] = id;
  };
  if (from.kind === to.kind && (to.kind === 'out' || (from.kind !== 'out' && from.i === to.i)))
    return next;
  const other = at(to);
  set(from, null);
  if (to.kind !== 'out') {
    // A bot stands once in a mode: not twice in the slots, not in a slot and on the bench.
    for (const list of [slots, next.bench])
      for (let i = 0; i < list.length; i++) if (list[i] === botId) list[i] = null;
    set(to, botId);
  }
  if (other && other !== botId) set(from, other);
  return next;
}

/** Whether two drafts are the same. */
export function sameDraft(a: LineupDraft, b: LineupDraft): boolean {
  const k = (d: LineupDraft) =>
    JSON.stringify([filled(d.dm, SLOTS), filled(d.mh, SLOTS), filled(d.bench, BENCH)]);
  return k(a) === k(b);
}
