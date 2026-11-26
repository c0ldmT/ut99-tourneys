/** Pure helpers of the hover cards (decision 318), testable without Angular. */

/** A link the card knows: a Dream Team bot or a manager's team. */
export type PeekTarget = { kind: 'bot'; id: string } | { kind: 'team'; id: string };

/** Which card a link's path shows (null: none). Bot pages of the library count too. */
export function peekTarget(path: string): PeekTarget | null {
  const m = /^\/(?:udt\/bot|bots)\/([^/?#]+)\/?$/.exec(path);
  if (m) return { kind: 'bot', id: decodeURIComponent(m[1]!) };
  const t = /^\/udt\/squads\/([^/?#]+)\/?$/.exec(path);
  if (t) return { kind: 'team', id: decodeURIComponent(t[1]!) };
  return null;
}

/** The last games as W/L, newest first (at most five). */
export function formOf(recent: readonly { won: boolean }[]): ('w' | 'l')[] {
  return recent.slice(0, 5).map((r) => (r.won ? 'w' : 'l'));
}
