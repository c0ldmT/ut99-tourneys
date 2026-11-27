import type { TournamentPresetBody } from './types';

/** Presets an admin keeps at most (as the API, decision 325). */
export const MAX_PRESETS = 20;

/** A short description of a preset: kind, mode, size and tempo ("Season · 1v1 · 8 · ×3"). */
export function presetHint(b: TournamentPresetBody, t: (k: string) => string): string {
  const s = b.settings;
  const kind =
    b.kind === 'udt' ? 'form.kindUdt' : b.seasonal ? 'form.kindSeason' : 'form.kindClassic';
  const k = s.teamSize ?? 1;
  const parts = [t(kind), k === 1 ? '1v1' : `${k}v${k}`, String(s.size)];
  if ((b.parallel ?? 1) > 1) parts.push(`×${b.parallel}`);
  return parts.join(' · ');
}
