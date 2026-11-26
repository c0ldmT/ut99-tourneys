import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLUB_UPGRADES, clubMaxLevel, CREST_SHAPES, SIGNATURES } from '@tourney/udt';
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

  it('has the club house keys (decision 268)', () => {
    for (const lang of ['en', 'de'] as const) {
      for (const k of CLUB_UPGRADES) {
        expect(DICT[lang][`udt.club.k.${k}`]).toBeDefined();
        expect(DICT[lang][`udt.club.n.${k}`]).toBeDefined();
        for (let n = 1; n <= clubMaxLevel(k); n++)
          expect(DICT[lang][`udt.club.e.${k}.${n}`]).toBeDefined();
      }
      for (const k of ['analysis', 'trophy'])
        expect(DICT[lang][`udt.club.link.${k}`]).toBeDefined();
      for (const s of CREST_SHAPES) expect(DICT[lang][`udt.crest.s.${s}`]).toBeDefined();
      for (const c of ['violet', 'cyan', 'gold', 'green', 'red', 'blue', 'pink', 'silver'])
        expect(DICT[lang][`udt.crest.c.${c}`]).toBeDefined();
      for (const k of ['league', 'cup', 'stage'])
        expect(DICT[lang][`udt.wall.kind.${k}`]).toBeDefined();
      // Signatures (decision 274) and the settled stage.
      for (const c of SIGNATURES) {
        expect(DICT[lang][`udt.sig.${c}`]).toBeDefined();
        expect(DICT[lang][`udt.sig.e.${c}`]).toBeDefined();
      }
      for (const st of ['mature', 'godlike', 'ascended', 'settled'])
        expect(DICT[lang][`udt.pres.stage.${st}`]).toBeDefined();
    }
  });

  it('has the dynamic keys', () => {
    for (const t of ['season', 'bets', 'bots', 'udt', 'league', 'system'])
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
    // The Dream Team league (page and settings).
    for (const lang of ['en', 'de'] as const) {
      for (const k of ['league', 'relegation', 'semi', 'final', 'third'])
        expect(DICT[lang][`league.kind.${k}`]).toBeDefined();
      for (const z of ['final', 'up', 'relup', 'rel', 'down'])
        expect(DICT[lang][`league.zone.${z}`]).toBeDefined();
      for (const v of ['table', 'day', 'plan', 'final', 'history'])
        expect(DICT[lang][`league.view.${v}`]).toBeDefined();
      for (const b of ['done', 'doneOt', 'live', 'next', 'later'])
        expect(DICT[lang][`league.badge.${b}`]).toBeDefined();
      for (const f of ['W', 'OW', 'OL', 'L']) {
        expect(DICT[lang][`league.form.${f}`]).toBeDefined();
        expect(DICT[lang][`league.formShort.${f}`]).toBeDefined();
      }
      for (const d of [0, 1, 2]) expect(DICT[lang][`lgs.day.${d}`]).toBeDefined();
      for (const m of ['month', 'list']) expect(DICT[lang][`cal.mode.${m}`]).toBeDefined();
      for (const g of ['all', 'tour', 'cup', 'league', 'season'])
        expect(DICT[lang][`cal.group.${g}`]).toBeDefined();
      for (const m of ['real', 'test'])
        for (const k of ['mode', 'modeHint', 'modeNote'])
          expect(DICT[lang][`lgs.${k}.${m}`]).toBeDefined();
      for (const l of ['short', 'medium', 'long'])
        expect(DICT[lang][`lgs.length.${l}`]).toBeDefined();
      for (const a of ['simulate', 'topGame', 'all'])
        expect(DICT[lang][`lgs.aiGames.${a}`]).toBeDefined();
      for (const p of ['cup', 'random', 'one'])
        expect(DICT[lang][`lgs.placement.${p}`]).toBeDefined();
    }
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

  it('picks the plural form (decision 296)', () => {
    expect(translate('de', 'cal.inDays', { n: 1 })).toBe('in 1 Tag');
    expect(translate('de', 'cal.inDays', { n: 3 })).toBe('in 3 Tagen');
    expect(translate('en', 'lgs.step.evenings', { n: 1, p: 2 })).toBe('1 evening with 2 matchdays');
    // No hand-made plurals like "Tag(e)" any more.
    for (const lang of ['en', 'de'] as const)
      for (const [key, text] of Object.entries(DICT[lang]))
        expect(/[a-zß]\((e|en|n|s|es)\)/.test(text), `${lang} ${key}`).toBe(false);
  });
});
