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
