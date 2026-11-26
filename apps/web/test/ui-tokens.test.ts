import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The UI ratchet (UX audit, decision 297): raw values the design tokens replace may only get fewer.
 * When a number here drops, lower its limit with it; a new raw value belongs in a token instead.
 */
const SRC = path.join(__dirname, '../src');

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** SVG drawings keep their own px sizes (they scale with the drawing, not the text). */
const SVG_FILES = ['bracket/bracket-view.ts', 'components/rating-chart.ts'];

const styles = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8');
const files = sources(path.join(SRC, 'app')).map((f) => ({
  name: path.relative(path.join(SRC, 'app'), f).split(path.sep).join('/'),
  text: fs.readFileSync(f, 'utf8'),
}));
const code = files.filter((f) => !SVG_FILES.includes(f.name));
/** styles.css without its token block (the first :root). */
const globalRules = styles.slice(styles.indexOf('}', styles.indexOf(':root')) + 1);

const count = (texts: string[], re: RegExp) =>
  texts.reduce((n, t) => n + (t.match(re)?.length ?? 0), 0);

describe('UI tokens (ratchet)', () => {
  it('sizes text only with the type scale', () => {
    const raw = /font-size:\s*[0-9.]+(rem|px)/g;
    // The root size (15.5px) and the smaller root on phones (15px) are the base of the scale.
    expect(count([globalRules], raw)).toBeLessThanOrEqual(2);
    expect(
      count(
        code.map((f) => f.text),
        raw,
      ),
    ).toBe(0);
  });

  it('rounds corners only with the radius tokens', () => {
    const raw = /border-radius:\s*[^;`]*\b[1-9][0-9]*px/g;
    expect(count([globalRules, ...code.map((f) => f.text)], raw)).toBe(0);
  });

  it('has no more raw colours than before', () => {
    const hex = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
    expect(count([globalRules], hex)).toBeLessThanOrEqual(81);
    expect(
      count(
        code.map((f) => f.text),
        hex,
      ),
    ).toBeLessThanOrEqual(126);
  });

  it('asks with the dialog of the website, not the browser', () => {
    const native = /[^.\w](confirm|prompt|alert)\(/g;
    expect(
      count(
        code.filter((f) => f.name !== 'components/confirm-dialog.ts').map((f) => f.text),
        native,
      ),
    ).toBeLessThanOrEqual(0);
  });

  it('formats dates through I18n', () => {
    const local = /\.toLocale(Date|Time)String\(|new Date\([^)]*\)\.toLocaleString\(/g;
    const outside = code.filter((f) => f.name !== 'core/i18n.ts');
    expect(
      count(
        outside.map((f) => f.text),
        local,
      ),
    ).toBeLessThanOrEqual(0);
  });
});
