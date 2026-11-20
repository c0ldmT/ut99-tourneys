import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, isNull } from 'drizzle-orm';
import type { User } from '../auth/users.service.js';
import { badRequest, conflict } from '../common/http.js';
import { randomId } from '../common/ids.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { feedback, feedbackSurveys } from '../db/schema.js';
import { SeasonsService } from '../seasons/seasons.service.js';
import { TournamentsService } from '../tournaments/tournaments.service.js';
import { UdtService } from '../udt/udt.service.js';
import {
  checkAnswers,
  NOTES_PER_DAY,
  SURVEY_QUESTIONS,
  SURVEY_TEXTS,
  type NoteInput,
  type SurveyInput,
} from './survey.js';

const DAY_MS = 86_400_000;

type Answers = Record<string, number | string>;
type Texts = Record<string, string>;

const parse = <T>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

/**
 * Feedback of the players (decision 245). The season survey: an admin opens it for the running
 * (or the last) season; every manager with a Dream Team team in that season answers once (and
 * may change the answer while it is open); `GET /me` carries `survey` while one is waiting, the
 * website then asks once per visit. Notes: any logged-in user, any time, an area and a text (at
 * most NOTES_PER_DAY a day). Admins download everything without names (managers numbered).
 */
@Injectable()
export class FeedbackService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(UdtService) private readonly udt: UdtService,
    @Inject(TournamentsService) private readonly tournaments: TournamentsService,
  ) {}

  onModuleInit(): void {
    // The website reset starts the seasons anew: feedback about the old ones goes with them.
    this.tournaments.onResetAll(() => {
      this.db.delete(feedback).run();
      this.db.delete(feedbackSurveys).run();
    });
  }

  private now(): string {
    return new Date(this.clock.now()).toISOString();
  }

  /** The open survey's season, if one is open. */
  openSeason(): number | null {
    return (
      this.db
        .select({ season: feedbackSurveys.season })
        .from(feedbackSurveys)
        .where(isNull(feedbackSurveys.closedAt))
        .orderBy(desc(feedbackSurveys.season))
        .get()?.season ?? null
    );
  }

  /** Managers of the season take part (AI managers never log in). */
  private eligible(userId: string, season: number): boolean {
    return !!this.udt.team(userId, season) && !this.udt.aiIds().has(userId);
  }

  private answerOf(userId: string, season: number) {
    return this.db
      .select()
      .from(feedback)
      .where(
        and(eq(feedback.kind, 'survey'), eq(feedback.season, season), eq(feedback.userId, userId)),
      )
      .get();
  }

  /** For `GET /me`: the survey waiting for this user, if any. */
  pending(userId: string): { season: number } | null {
    const season = this.openSeason();
    if (season === null || !this.eligible(userId, season) || this.answerOf(userId, season))
      return null;
    return { season };
  }

  /** The survey for the user: questions, whether they take part, their answer so far. */
  survey(user: User) {
    const season = this.openSeason();
    const mine = season !== null ? this.answerOf(user.id, season) : undefined;
    return {
      season,
      open: season !== null,
      eligible: season !== null && this.eligible(user.id, season),
      questions: SURVEY_QUESTIONS,
      texts: SURVEY_TEXTS,
      answer: mine
        ? {
            answers: parse<Answers>(mine.answersJson, {}),
            texts: parse<Texts>(mine.textsJson, {}),
            updatedAt: mine.updatedAt,
          }
        : null,
    };
  }

  /** Saves (or replaces) the user's answer to the open survey. */
  answer(user: User, body: SurveyInput) {
    const season = this.openSeason();
    if (season === null) throw conflict('the survey is closed');
    if (!this.eligible(user.id, season))
      throw conflict('only managers of season {season} take part in its survey', { season });
    const answers = checkAnswers(body.answers);
    if (!answers) throw badRequest('an answer is out of range');
    const texts: Texts = {};
    for (const k of SURVEY_TEXTS) {
      const t = body.texts[k]?.trim();
      if (t) texts[k] = t;
    }
    if (!Object.keys(answers).length && !Object.keys(texts).length)
      throw badRequest('answer at least one question');
    const now = this.now();
    const before = this.answerOf(user.id, season);
    const values = { answersJson: JSON.stringify(answers), textsJson: JSON.stringify(texts) };
    if (before)
      this.db
        .update(feedback)
        .set({ ...values, updatedAt: now })
        .where(eq(feedback.id, before.id))
        .run();
    else
      this.db
        .insert(feedback)
        .values({
          id: randomId(),
          userId: user.id,
          season,
          kind: 'survey',
          ...values,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    return this.survey(user);
  }

  /** A note at any time. */
  note(user: User, body: NoteInput): { ok: true } {
    const since = new Date(this.clock.now() - DAY_MS).toISOString();
    const today =
      this.db
        .select({ n: count() })
        .from(feedback)
        .where(
          and(
            eq(feedback.kind, 'note'),
            eq(feedback.userId, user.id),
            gte(feedback.createdAt, since),
          ),
        )
        .get()?.n ?? 0;
    if (today >= NOTES_PER_DAY)
      throw conflict('at most {n} feedback notes a day', { n: NOTES_PER_DAY });
    const now = this.now();
    this.db
      .insert(feedback)
      .values({
        id: randomId(),
        userId: user.id,
        season: this.seasons.current()?.number ?? null,
        kind: 'note',
        area: body.area,
        textsJson: JSON.stringify({ text: body.text.trim() }),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return { ok: true };
  }

  /** The season a survey would be for: the running one, else the last that started. */
  private targetSeason(): number | null {
    return (this.seasons.current() ?? this.seasons.latestStarted())?.number ?? null;
  }

  /** Admin: survey state and how many answered. */
  admin() {
    const open = this.openSeason();
    const season = open ?? this.targetSeason();
    const row =
      season !== null
        ? this.db.select().from(feedbackSurveys).where(eq(feedbackSurveys.season, season)).get()
        : undefined;
    const answers =
      season !== null
        ? (this.db
            .select({ n: count() })
            .from(feedback)
            .where(and(eq(feedback.kind, 'survey'), eq(feedback.season, season)))
            .get()?.n ?? 0)
        : 0;
    const ai = this.udt.aiIds();
    const managers =
      season !== null ? this.udt.teams(season).filter((t) => !ai.has(t.userId)).length : 0;
    const notes =
      this.db.select({ n: count() }).from(feedback).where(eq(feedback.kind, 'note')).get()?.n ?? 0;
    return {
      season,
      open: open !== null,
      openedAt: row?.openedAt ?? null,
      closedAt: row?.closedAt ?? null,
      answers,
      managers,
      notes,
    };
  }

  /** Admin: opens the survey of the running (or last) season, or closes it. */
  setSurvey(open: boolean) {
    const now = this.now();
    if (!open) {
      this.db
        .update(feedbackSurveys)
        .set({ closedAt: now })
        .where(isNull(feedbackSurveys.closedAt))
        .run();
      return this.admin();
    }
    const season = this.targetSeason();
    if (season === null) throw conflict('no season is running');
    this.db.transaction((tx) => {
      // One survey at a time.
      tx.update(feedbackSurveys)
        .set({ closedAt: now })
        .where(isNull(feedbackSurveys.closedAt))
        .run();
      tx.insert(feedbackSurveys)
        .values({ season, openedAt: now, closedAt: null })
        .onConflictDoUpdate({ target: feedbackSurveys.season, set: { closedAt: null } })
        .run();
    });
    return this.admin();
  }

  /**
   * Admin: the answers of a season's survey and all notes, without names or ids (managers are
   * numbered in the order they answered), for a review or the analysis.
   */
  export(season?: number) {
    const s = season ?? this.openSeason() ?? this.targetSeason();
    const answers =
      s === null
        ? []
        : this.db
            .select()
            .from(feedback)
            .where(and(eq(feedback.kind, 'survey'), eq(feedback.season, s)))
            .orderBy(asc(feedback.createdAt))
            .all();
    const notes = this.db
      .select()
      .from(feedback)
      .where(eq(feedback.kind, 'note'))
      .orderBy(asc(feedback.createdAt))
      .all();
    const who = new Map<string, number>();
    const n = (userId: string) => {
      if (!who.has(userId)) who.set(userId, who.size + 1);
      return who.get(userId)!;
    };
    return {
      season: s,
      questions: SURVEY_QUESTIONS.map((q) => q.id),
      texts: SURVEY_TEXTS,
      survey: answers.map((r) => ({
        manager: n(r.userId),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        answers: parse<Answers>(r.answersJson, {}),
        texts: parse<Texts>(r.textsJson, {}),
      })),
      notes: notes.map((r) => ({
        manager: n(r.userId),
        season: r.season,
        createdAt: r.createdAt,
        area: r.area,
        text: parse<Texts>(r.textsJson, {}).text ?? '',
      })),
    };
  }
}
