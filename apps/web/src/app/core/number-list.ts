/** Lists of numbers in one text field ("1200 · 700 · 400 · 200"), as in the league settings. */

/** "1200 · 700 · 400" ⇄ numbers (also "1,4" with a decimal comma). */
export function formatList(xs: readonly number[], de: boolean): string {
  return xs.map((x) => (de ? String(x).replace('.', ',') : String(x))).join(' · ');
}
/**
 * "1200 · 700 · 400" (also with ";", "/" or blanks between; "1.200" and "1,4" in German) →
 * numbers; null when a part is no number.
 */
export function parseList(s: string, de: boolean): number[] | null {
  const parts = s
    .split(/[·;/|\s]+/)
    .map((x) => x.trim())
    .filter((x) => x !== '');
  const out = parts.map((x) =>
    Number(
      de
        ? x.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
        : x.replace(/,(?=\d{3}(\D|$))/g, ''),
    ),
  );
  return out.every((x) => Number.isFinite(x)) ? out : null;
}
