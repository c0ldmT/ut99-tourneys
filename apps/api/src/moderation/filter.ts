/**
 * Word filter for what players type (decision 283): names, team names and tags, bot names, bot
 * chat lines, messages. Pure functions; the lists come from `word-lists.ts` and the settings.
 *
 * A list entry is matched against a normalised form of the text:
 * - lower case, accents and umlauts folded (ä → a, ß → ss), leetspeak folded (0 → o, 1 → i,
 *   3 → e, 4 → a, 5 → s, 7 → t, @ → a, $ → s, ! → i, | → i),
 * - `word` (no prefix): found anywhere in the text with everything but letters and digits removed
 *   ("f.u.c.k", "F U C K"), also with letters that repeat squeezed to one ("fuuuck"),
 * - `=word`: only as a whole word (short words that are part of harmless ones: "=ass").
 * Words of the allow list are cut out of the text first (they win against a hit inside them).
 */

export type FilterLevel = 'block' | 'flag';

export interface FilterLists {
  block: readonly string[];
  flag: readonly string[];
  allow: readonly string[];
}

export interface FilterHit {
  level: FilterLevel;
  /** The list entry that matched (for the moderators, never shown to the writer). */
  term: string;
}

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'i',
};

/** Lower case, accents folded, ß → ss (digits stay). */
function fold(text: string): string {
  return text.toLowerCase().replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

const leet = (s: string) => s.replace(/[013457@$!|]/g, (c) => LEET[c] ?? c);
const squeeze = (s: string) => s.replace(/(.)\1+/g, '$1');

/** The forms a text is searched in. */
export interface Normalised {
  /** Letters and digits only, leetspeak folded. */
  compact: string;
  /** The same with repeated letters squeezed. */
  squeezed: string;
  /** Digits as typed (codes such as 1488), letters and digits only. */
  digits: string;
  /** Words (leetspeak folded). */
  words: string[];
}

export function normalise(text: string, allow: readonly string[] = []): Normalised {
  let f = fold(text);
  const digits = f.replace(/[^a-z0-9]/g, '');
  f = leet(f);
  let compact = f.replace(/[^a-z0-9]/g, '');
  const words = f.split(/[^a-z0-9]+/).filter(Boolean);
  for (const a of allow) {
    const w = entry(a).word;
    if (w) compact = compact.split(w).join('');
  }
  const allowed = new Set(allow.map((a) => entry(a).word));
  return {
    compact,
    squeezed: squeeze(compact),
    digits,
    words: words.filter((w) => !allowed.has(w)),
  };
}

/**
 * A list entry: its normalised word, whether only a whole word counts, and whether it is a
 * number (searched in the digits as typed: "1488").
 */
function entry(raw: string): { word: string; whole: boolean; number: boolean } {
  const t = raw.trim();
  const whole = t.startsWith('=');
  const body = fold(whole ? t.slice(1) : t).replace(/[^a-z0-9]/g, '');
  const number = /^\d+$/.test(body);
  return { word: number ? body : leet(body), whole, number };
}

function matches(n: Normalised, raw: string): boolean {
  const { word, whole, number } = entry(raw);
  if (!word) return false;
  if (number) return n.digits.includes(word);
  // Squeezed forms only for words that keep their shape ("kkk" would become "k").
  const sq = squeeze(word);
  const useSq = sq.length >= 4;
  if (whole) return n.words.includes(word) || (useSq && n.words.map(squeeze).includes(sq));
  return n.compact.includes(word) || (useSq && n.squeezed.includes(sq));
}

/** The worst hit of a text (block before flag), or null. */
export function checkText(text: string, lists: FilterLists): FilterHit | null {
  if (!text.trim()) return null;
  const n = normalise(text, lists.allow);
  for (const term of lists.block) if (matches(n, term)) return { level: 'block', term };
  for (const term of lists.flag) if (matches(n, term)) return { level: 'flag', term };
  return null;
}

/** Entries of a list as an admin typed them: trimmed, lower case, no empties or doubles. */
export function cleanList(list: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of list) {
    const t = raw.trim().toLowerCase();
    if (t && t !== '=') out.add(t);
  }
  return [...out];
}
