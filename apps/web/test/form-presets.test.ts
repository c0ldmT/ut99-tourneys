import { describe, expect, it } from 'vitest';
import { presetHint } from '../src/app/core/presets';
import { DICT } from '../src/app/core/i18n-dict';
import type { TournamentPresetBody } from '../src/app/core/types';

const t = (k: string) => DICT.de[k] ?? k;
const body = (over: Partial<TournamentPresetBody>, teamSize = 1, size = 8) =>
  ({
    agentId: 'pi',
    profileId: 'local',
    settings: { size, teamSize },
    ...over,
  }) as unknown as TournamentPresetBody;

describe('tournament presets (decision 325)', () => {
  it('describes a preset by kind, mode, size and tempo', () => {
    expect(presetHint(body({ seasonal: true }), t)).toBe('Season · 1v1 · 8');
    expect(presetHint(body({ kind: 'udt', seasonal: true, parallel: 3 }, 5, 16), t)).toBe(
      'Dream Team · 5v5 · 16 · ×3',
    );
    expect(presetHint(body({}, 2, 4), t)).toBe('Klassisch · 2v2 · 4');
  });
});
