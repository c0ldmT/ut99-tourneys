import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERRORS_DE, errorMessage } from '../src/app/core/i18n-errors';

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Every error template of the API: the helpers' texts and the schemas' own messages. */
function apiTemplates(): Set<string> {
  const out = new Set<string>();
  const unq = (s: string) => s.replace(/\\'/g, "'");
  for (const file of sources(path.join(__dirname, '../../api/src'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(
      /\b(badRequest|conflict|forbidden|notFound)\(\s*'((?:[^'\\]|\\.)*)'/g,
    ))
      out.add(m[1] === 'notFound' ? `${unq(m[2]!)} not found` : unq(m[2]!));
    for (const m of text.matchAll(/\.(?:refine|regex)\([^;]*?,\s*'((?:[^'\\]|\\.)*)'\s*\)/g))
      out.add(unq(m[1]!));
  }
  // Built elsewhere: the guard, agent errors.
  for (const k of [
    'login required',
    'agent {id} is not connected',
    'agent {id} did not answer {command}',
    'server shutting down',
  ])
    out.add(k);
  return out;
}

describe('error texts', () => {
  it('translates every error template of the API into German', () => {
    const keys = apiTemplates();
    expect(keys.size).toBeGreaterThan(150);
    const missing = [...keys].filter((k) => !(k in ERRORS_DE)).sort();
    expect(missing).toEqual([]);
  });

  it('fills the values, translates phases and ends English texts with a full stop', () => {
    const e = {
      status: 409,
      message: 'not enough Neuro: 40 can be spent (rescue floor 100)',
      key: 'not enough Neuro: {spendable} can be spent (rescue floor {floor})',
      params: { spendable: 40, floor: 100 },
    };
    expect(errorMessage('de', e)).toBe(
      'Nicht genug Neuro: Du kannst 40 ausgeben (Rettungsgrenze 100).',
    );
    expect(errorMessage('en', e)).toBe('Not enough Neuro: 40 can be spent (rescue floor 100)');
    const phase = {
      status: 409,
      message: 'cannot seed in phase running',
      key: 'cannot seed in phase {phase}',
      params: { phase: 'running' },
    };
    expect(errorMessage('de', phase)).toBe('In der Phase „Läuft“ kann nicht gesetzt werden.');
    expect(
      errorMessage('en', { status: 409, message: 'the bot is sold', key: 'the bot is sold' }),
    ).toBe('The bot is sold.');
  });

  it('falls back: network, login, validation, server, unknown texts', () => {
    expect(errorMessage('de', { status: 0, message: 'x' })).toMatch(/nicht erreichbar/);
    expect(errorMessage('de', { status: 401, message: 'login required' })).toMatch(/melde dich an/);
    expect(
      errorMessage('de', {
        status: 400,
        message: '✖ Too small',
        key: 'invalid input',
        params: { field: 'name' },
      }),
    ).toBe('Ungültige Eingabe: name.');
    expect(errorMessage('de', { status: 500, message: 'Internal server error' })).toMatch(
      /Server ist etwas schiefgegangen/,
    );
    // A text of the game server or the bridge stays as it came.
    expect(
      errorMessage('de', { status: 409, message: 'map not found', key: 'map not found' }),
    ).toBe('Map not found');
  });
});
