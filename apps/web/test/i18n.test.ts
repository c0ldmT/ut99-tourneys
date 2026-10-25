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
    for (const t of ['season', 'bets', 'bots', 'udt', 'system'])
      expect(DICT.en[`settings.tab.${t}`]).toBeDefined();
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
    // Origins of own Dream Team bots (badges on My team, squads, yearbook).
    for (const o of ['starter', 'academy', 'apprentice', 'blueprint'])
      expect(DICT.en[`udt.academy.origin.${o}`]).toBeDefined();
    // Why a bot cannot be kept (keeper choice).
    for (const w of ['bought', 'nominated', 'graduated', 'rejected'])
      for (const lang of ['en', 'de'] as const)
        expect(DICT[lang][`udt.keep.why.${w}`]).toBeDefined();
    // Why a bot cannot be an apprentice (mentor panel).
    for (const w of ['bought', 'mentored', 'skill', 'nominated'])
      for (const lang of ['en', 'de'] as const)
        expect(DICT[lang][`udt.mentor.not.${w}`]).toBeDefined();
    // What an apprentice learns (academy).
    for (const k of ['accuracy', 'alertness', 'strafing', 'combatStyle', 'camping'])
      expect(DICT.en[`udt.academy.lesson.${k}`]).toBeDefined();
    // Teams left out at a Dream Team draw (toast after the draw).
    for (const r of ['busy', 'lineup', 'full'])
      for (const lang of ['en', 'de'] as const)
        expect(DICT[lang][`tp.udtDropped.${r}`]).toBeDefined();
  });

  it('fills parameters and falls back to English', () => {
    expect(translate('de', 'list.registered', { n: 5 })).toBe('5 angemeldet');
    expect(translate('de', 'no.such.key')).toBe('no.such.key');
  });
});
