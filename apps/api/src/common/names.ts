/**
 * In-game names: UT99 shows them on the scoreboard and the mod uses them to find the sender of a
 * spectator's chat command, so they are printable ASCII, at most 20 characters, unique.
 */
export const MAX_NAME = 20;

export function sanitizeName(raw: string): string {
  const ascii = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^\x21-\x7e ]/g, '')
    .replace(/[:"\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return ascii.slice(0, MAX_NAME).trim();
}

export const nameKey = (name: string) => name.toLowerCase();

/** "Mario" -> "Mario2" -> "Mario3" ... until `taken` says no. */
export function uniqueName(base: string, taken: (key: string) => boolean): string {
  const clean = sanitizeName(base) || 'Player';
  if (!taken(nameKey(clean))) return clean;
  for (let i = 2; i < 10_000; i++) {
    const suffix = String(i);
    const candidate = clean.slice(0, MAX_NAME - suffix.length) + suffix;
    if (!taken(nameKey(candidate))) return candidate;
  }
  throw new Error('no free name');
}

/**
 * Team names from the admin's list (Settings › team names) in random order, none twice and none
 * that `taken` holds (lower case; the picked ones are added). When the list runs out,
 * `fallback(i)` names the rest (also unique).
 */
export function pickTeamNames(
  list: readonly string[],
  count: number,
  taken: Set<string>,
  rng: () => number,
  fallback: (i: number) => string,
): string[] {
  const pool = list.filter((n) => !taken.has(n.toLowerCase()));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const out: string[] = [];
  let f = 0;
  for (let n = 0; n < count; n++) {
    let name = pool.shift();
    while (name !== undefined && taken.has(name.toLowerCase())) name = pool.shift();
    if (name === undefined) {
      do name = fallback(f++);
      while (taken.has(name.toLowerCase()));
    }
    taken.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}
