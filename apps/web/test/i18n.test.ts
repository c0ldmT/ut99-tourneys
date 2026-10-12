import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DICT, translate } from '../src/app/core/i18n-dict';

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('translations', () => {
  it('has the same keys in English and German', () => {
    expect(Object.keys(DICT.de).sort()).toEqual(Object.keys(DICT.en).sort());
  });

  it('has every key the templates use', () => {
    const used = new Set<string>();
    for (const file of sources(path.join(__dirname, '../src/app'))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/'([a-zA-Z]+\.[a-zA-Z.]+)' \| t/g)) used.add(m[1]!);
      for (const m of text.matchAll(/\bt\('([a-zA-Z]+\.[a-zA-Z.]+)'/g)) used.add(m[1]!);
    }
    const missing = [...used].filter((k) => !(k in DICT.en));
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(100);
  });

  it('has the dynamic keys', () => {
    for (const p of ['draft', 'seeded', 'checkIn', 'running', 'paused', 'finished', 'aborted'])
      expect(DICT.en[`phase.${p}`]).toBeDefined();
    for (const p of [
      'voting',
      'loading',
      'readyCheck',
      'countdown',
      'live',
      'overtime',
      'paused',
      'post',
    ])
      expect(DICT.en[`live.${p}`]).toBeDefined();
    for (let s = 0; s <= 7; s++) expect(DICT.en[`skill.${s}`]).toBeDefined();
  });

  it('fills parameters and falls back to English', () => {
    expect(translate('de', 'list.registered', { n: 5 })).toBe('5 angemeldet');
    expect(translate('de', 'no.such.key')).toBe('no.such.key');
  });
});
