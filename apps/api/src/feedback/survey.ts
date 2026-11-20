import { z } from 'zod';

/**
 * The season survey (decision 245): what the players think of a Dream Team season, next to the
 * numbers of the snapshots (244). Questions are scales (1-5) or choices; the website shows them
 * with the texts `fb.q.<id>` and `fb.o.<id>.<option>`. Ids and options only grow (answers of
 * earlier seasons keep their meaning); a question that goes stays out of the list.
 */
export interface SurveyQuestion {
  id: string;
  kind: 'scale' | 'choice';
  /** Choice options (a scale is 1-5). */
  options?: readonly string[];
}

export const SURVEY_QUESTIONS: readonly SurveyQuestion[] = [
  { id: 'fun', kind: 'scale' },
  { id: 'time', kind: 'choice', options: ['lt10', '10to30', '30to60', 'gt60'] },
  { id: 'money', kind: 'choice', options: ['hard', 'ok', 'easy'] },
  { id: 'prices', kind: 'choice', options: ['low', 'ok', 'high'] },
  { id: 'salaries', kind: 'choice', options: ['low', 'ok', 'high'] },
  { id: 'development', kind: 'choice', options: ['slow', 'ok', 'fast'] },
  { id: 'traits', kind: 'choice', options: ['weak', 'ok', 'strong'] },
  { id: 'leagueLength', kind: 'choice', options: ['short', 'ok', 'long'] },
  { id: 'leagueAi', kind: 'choice', options: ['weak', 'ok', 'strong'] },
  { id: 'again', kind: 'choice', options: ['yes', 'maybe', 'no'] },
];

/** Free texts of the survey (each optional). */
export const SURVEY_TEXTS = ['best', 'worst', 'wish'] as const;

/** Areas of a feedback note. */
export const FEEDBACK_AREAS = [
  'dreamTeam',
  'league',
  'tournaments',
  'bets',
  'website',
  'other',
] as const;

export const TEXT_MAX = 2000;
/** Notes per user and day (no flood). */
export const NOTES_PER_DAY = 10;

const text = z.string().trim().max(TEXT_MAX);

export const SurveyBody = z.object({
  answers: z.record(z.string(), z.union([z.number().int(), z.string()])).default({}),
  texts: z.partialRecord(z.enum(SURVEY_TEXTS), text).default({}),
});
export type SurveyInput = z.infer<typeof SurveyBody>;

export const NoteBody = z.object({
  area: z.enum(FEEDBACK_AREAS),
  text: text.min(3),
});
export type NoteInput = z.infer<typeof NoteBody>;

export const SurveySwitchBody = z.object({ open: z.boolean() });

/** The answers that fit the questions (others are dropped); null when one is out of range. */
export function checkAnswers(
  answers: Record<string, number | string>,
): Record<string, number | string> | null {
  const out: Record<string, number | string> = {};
  for (const q of SURVEY_QUESTIONS) {
    const v = answers[q.id];
    if (v === undefined) continue;
    if (q.kind === 'scale') {
      if (typeof v !== 'number' || v < 1 || v > 5) return null;
    } else if (typeof v !== 'string' || !q.options!.includes(v)) return null;
    out[q.id] = v;
  }
  return out;
}
