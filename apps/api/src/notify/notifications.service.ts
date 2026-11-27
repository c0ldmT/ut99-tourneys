import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { MatchResult } from '@tourney/bracket';
import {
  TournamentSettingsSchema,
  type Entrant,
  type TournamentEvent,
  type TournamentProjection,
} from '@tourney/protocol';
import { AgentsService } from '../agents/agents.service.js';
import { ShopService } from '../shop/shop.service.js';
import { BetsService } from '../bets/bets.service.js';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { CLOCK, CONFIG, type ApiClock, type ApiConfig } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { registrations, tournaments, users } from '../db/schema.js';
import { EventLogService } from '../tournaments/event-log.service.js';
import {
  DISCORD_OUT,
  isDiscordId,
  isWebhookUrl,
  type DiscordOut,
  type DiscordPost,
} from './discord-out.js';
import * as M from './messages.js';
import { ServerActivity } from '../common/activity.js';

type TournamentRow = typeof tournaments.$inferSelect;
type UserRow = typeof users.$inferSelect;

/** A challenge for the notifications: its managers and the texts' facts (decision 339). */
export interface ChallengeNote {
  fromUser: string;
  toUser: string | null;
  info: M.ChallengeInfo;
}

/** Challenge tournaments (decision 335) post their own embeds. */
function isChallenge(t: TournamentRow): boolean {
  try {
    return !!(JSON.parse(t.udtJson ?? 'null') as { challenge?: unknown } | null)?.challenge;
  } catch {
    return false;
  }
}

export const NOTIFY_MODES = ['default', 'custom', 'off'] as const;
export type NotifyMode = (typeof NOTIFY_MODES)[number];

/**
 * Discord notifications: a channel (webhook) and direct messages (bot). Entirely optional: with
 * nothing configured nothing is sent, and a failure here is logged and never reaches the
 * tournament (the event log calls in after the append, inside a try/catch; sending is queued).
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(ServerActivity) private readonly activity: ServerActivity,
    @Inject(LOGGER) private readonly log: ApiLogger,
    @Inject(EventLogService) private readonly events: EventLogService,
    @Inject(AgentsService) private readonly agents: AgentsService,
    @Inject(DISCORD_OUT) private readonly out: DiscordOut,
    @Inject(BetsService) private readonly bets: BetsService,
    @Inject(ShopService) private readonly shop: ShopService,
  ) {}

  onModuleInit(): void {
    const n = this.config.notify;
    if (n.webhookUrl && !isWebhookUrl(n.webhookUrl))
      this.log.warn('DISCORD_WEBHOOK_URL is not a Discord webhook URL: the default channel is off');
    this.log.info(
      `notifications: channel ${this.defaultWebhook() ? 'on' : 'off'}, direct messages ${n.botToken ? 'on' : 'off'}`,
    );
    this.events.onAppend((id, stored, after, before) => this.onAppended(id, stored, after, before));
    if (n.remindMin > 0) {
      this.timer = setInterval(
        () =>
          void this.activity.task('reminders', () =>
            this.safely('reminders', () => this.remindTick()),
          ),
        60_000,
      );
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** What the website shows in the form (no secrets). */
  status() {
    return {
      defaultChannel: !!this.defaultWebhook(),
      directMessages: !!this.config.notify.botToken,
    };
  }

  private get lang(): M.Lang {
    return this.config.notify.lang;
  }

  private safely(what: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.log.warn(`notifications (${what}): ${(e as Error).message}`);
    }
  }

  private defaultWebhook(): string | null {
    const url = this.config.notify.webhookUrl;
    return url && isWebhookUrl(url) ? url : null;
  }

  private channel(t: TournamentRow): string | null {
    if (t.notifyMode === 'off') return null;
    if (t.notifyMode === 'custom')
      return t.webhookUrl && isWebhookUrl(t.webhookUrl) ? t.webhookUrl : null;
    return this.defaultWebhook();
  }

  private post(t: TournamentRow, text: string | DiscordPost): void {
    const url = this.channel(t);
    if (url) this.out.webhook(url, text);
  }

  private row(id: string): TournamentRow | undefined {
    return this.db.select().from(tournaments).where(eq(tournaments.id, id)).get();
  }

  private info(t: TournamentRow): M.TournamentInfo {
    return {
      name: t.name,
      link: `${this.config.publicUrl}/t/${t.id}`,
      settings: TournamentSettingsSchema.parse(JSON.parse(t.settingsJson)),
      scheduledAt: t.scheduledAt,
    };
  }

  private address(t: TournamentRow): string | null {
    return t.connectAddress || this.agents.profile(t.agentId, t.profileId)?.publicAddress || null;
  }

  /** Direct messages to website users who want them and have a Discord account. */
  private dm(userIds: readonly string[], text: (u: UserRow) => string): void {
    if (!this.config.notify.botToken || !userIds.length) return;
    const rows = this.db
      .select()
      .from(users)
      .where(inArray(users.id, [...new Set(userIds)]))
      .all();
    for (const u of rows)
      if (u.notifyDm && isDiscordId(u.discordId)) this.out.dm(u.discordId, text(u));
  }

  private static userIds(e: Entrant | undefined): string[] {
    if (e?.kind === 'human') return [e.userId];
    if (e?.kind === 'team') return e.members.map((m) => m.userId);
    return [];
  }

  // ------------------------------------------------------------------------------------------
  // Draft: registration open, teams, reminder
  // ------------------------------------------------------------------------------------------

  /** Posts "registration open" once per tournament (after create/update, when it is open). */
  announceIfOpen(tournamentId: string): void {
    this.safely('announce', () => {
      const t = this.row(tournamentId);
      if (!t || !t.registrationOpen || t.announcedAt || t.phase !== 'draft' || !this.channel(t))
        return;
      this.post(t, M.announceEmbed(this.lang, this.info(t)));
      this.db
        .update(tournaments)
        .set({ announcedAt: new Date(this.clock.now()).toISOString() })
        .where(eq(tournaments.id, t.id))
        .run();
    });
  }

  /** A player joined a team: confirmation for them, a note for the captain. */
  teamJoined(tournamentId: string, team: { name: string; captainId: string }, user: UserRow): void {
    this.safely('team', () => {
      const t = this.row(tournamentId);
      if (!t) return;
      const info = this.info(t);
      this.dm([user.id], () => M.dmJoinedTeam(this.lang, info, team.name));
      if (team.captainId !== user.id)
        this.dm([team.captainId], () => M.dmTeamJoin(this.lang, info, team.name, user.displayName));
    });
  }

  /** Reminds registered players NOTIFY_REMIND_MIN minutes before the scheduled start. */
  remindTick(): void {
    const ahead = this.config.notify.remindMin * 60_000;
    if (!ahead || !this.config.notify.botToken) return;
    const now = this.clock.now();
    const due = this.db
      .select()
      .from(tournaments)
      .where(and(isNotNull(tournaments.scheduledAt), isNull(tournaments.remindedAt)))
      .all()
      .filter((t) => {
        const at = Date.parse(t.scheduledAt ?? '');
        return (t.phase === 'draft' || t.phase === 'seeded') && at > now && at - now <= ahead;
      });
    for (const t of due) {
      const ids = this.db
        .select({ id: registrations.userId })
        .from(registrations)
        .where(eq(registrations.tournamentId, t.id))
        .all()
        .map((r) => r.id);
      const info = this.info(t);
      this.dm(ids, () => M.dmReminder(this.lang, info));
      this.db
        .update(tournaments)
        .set({ remindedAt: new Date(now).toISOString() })
        .where(eq(tournaments.id, t.id))
        .run();
    }
  }

  // ------------------------------------------------------------------------------------------
  // Event log: check-in, matches, results, champion
  // ------------------------------------------------------------------------------------------

  private onAppended(
    id: string,
    stored: readonly TournamentEvent[],
    after: TournamentProjection,
    before: () => TournamentProjection | undefined,
  ): void {
    this.safely('events', () => {
      const t = this.row(id);
      if (!t) return;
      // A challenge posts its own embeds (decision 339): only "bets closed" comes from here.
      if (isChallenge(t)) {
        for (const e of stored)
          if (e.type === 'match.started') this.betsClosed(t, after, e.data.matchId, e.at);
        return;
      }
      const info = this.info(t);
      for (const e of stored) {
        switch (e.type) {
          case 'checkin.opened': {
            const deadline = new Date(
              Date.parse(e.at) + after.settings.checkInWindowMin * 60_000,
            ).toISOString();
            this.post(t, M.checkInEmbed(this.lang, info, deadline));
            const address = this.address(t);
            const ids = Object.values(after.entrants).flatMap((x) =>
              NotificationsService.userIds(x),
            );
            this.dm(ids, (u) => M.dmCheckIn(this.lang, info, address, u.joinToken));
            break;
          }
          case 'match.called': {
            this.betsOpen(t, after, e.data.matchId);
            const address = this.address(t);
            const [a, b] = e.data.entrants;
            for (const [me, opp] of [
              [a, b],
              [b, a],
            ] as const) {
              const oppName = after.entrants[opp]?.displayName ?? opp;
              this.dm(NotificationsService.userIds(after.entrants[me]), (u) =>
                M.dmMatchCalled(this.lang, info, e.data.matchId, oppName, address, u.joinToken),
              );
            }
            break;
          }
          case 'match.started':
            this.betsClosed(t, after, e.data.matchId, e.at);
            break;
          case 'match.result': {
            const r = e.data.result as MatchResult;
            const s = this.bets.discordMatch(t.id, r.matchId);
            const payout = s && M.betsPayout(this.lang, s, this.betNames(after));
            this.post(t, M.resultEmbed(this.lang, after, r, this.matchLink(t, r.matchId), payout));
            break;
          }
          case 'tournament.finished': {
            // A league matchday has no champion (the league posts its own results).
            if (!after.championId) break;
            const s = this.bets.discordTournament(t.id);
            const summary = s && M.betsTournament(this.lang, s, this.betNames(after));
            const w = after.entrants[after.championId ?? ''];
            const fanfare = w?.kind === 'human' ? this.shop.fanfareLook(w.userId) : null;
            this.post(t, M.championEmbed(this.lang, after, info.link, summary, fanfare));
            break;
          }
          default:
            break;
        }
      }
      if (stored.some((e) => e.type === 'match.result')) this.placements(info, before(), after);
    });
  }

  // ------------------------------------------------------------------------------------------
  // Bets with Neuro (season tournaments; switch in the season's betting settings)
  // ------------------------------------------------------------------------------------------

  private matchLink(t: TournamentRow, matchId: string): string {
    return `${this.config.publicUrl}/t/${t.id}/m/${matchId}`;
  }

  private betNames(p: TournamentProjection): M.BetNames {
    const bettor = this.bets.bettorNames();
    return { entrant: (id) => p.entrants[id]?.displayName ?? id, bettor };
  }

  /** "Bets open" when a match is called and keeps taking bets for the betting phase. */
  private betsOpen(t: TournamentRow, p: TournamentProjection, matchId: string): void {
    if (!this.channel(t)) return;
    const open = this.bets.discordOpen(t.id, matchId);
    const m = p.bracket?.matches.find((x) => x.id === matchId);
    const [a, b] = m?.entrants ?? [];
    if (!open || !a || !b) return;
    const name = (id: string) => p.entrants[id]?.displayName ?? id;
    this.post(
      t,
      M.betsOpenEmbed(this.lang, name(a), name(b), open.windowSec, this.matchLink(t, matchId)),
    );
  }

  /** "Bets closed" with the pools when the first game of a match started. */
  private betsClosed(t: TournamentRow, p: TournamentProjection, matchId: string, at: string) {
    const s = this.bets.discordMatch(t.id, matchId, at);
    if (s)
      this.post(t, M.betsClosedEmbed(this.lang, s, this.betNames(p), this.matchLink(t, matchId)));
  }

  /** Entrants that just got their final place hear about it. */
  private placements(
    info: M.TournamentInfo,
    before: TournamentProjection | undefined,
    after: TournamentProjection,
  ): void {
    const old = new Map((before?.bracket?.standings ?? []).map((s) => [s.entrantId, s.placement]));
    for (const s of after.bracket?.standings ?? []) {
      if (!s.placement || old.get(s.entrantId) === s.placement) continue;
      const e = after.entrants[s.entrantId];
      const team = e?.kind === 'team' ? e.displayName : undefined;
      this.dm(NotificationsService.userIds(e), () =>
        M.dmPlacement(this.lang, info, s.placement as number, team),
      );
    }
  }

  // ------------------------------------------------------------------------------------------
  // Challenges (decision 339): the channel (accepted, bets open, result, record), direct
  // messages (new, answer, reminder before the lock, expired, called off)
  // ------------------------------------------------------------------------------------------

  /** The default channel (challenges have no channel of their own). */
  private postDefault(text: DiscordPost): void {
    const url = this.defaultWebhook();
    if (url) this.out.webhook(url, text);
  }

  /** A new challenge, a counter offer or a rematch: the challenged manager hears about it. */
  challengeSent(c: ChallengeNote, kind: 'new' | 'counter' | 'rematch'): void {
    this.safely('challenge', () => {
      if (c.toUser) this.dm([c.toUser], () => M.dmChallenge(this.lang, c.info, kind));
    });
  }

  /**
   * The answer: the challenger hears it; an accepted challenge goes to the channel (Monster Hunt
   * as the showcase with the record of its map).
   */
  challengeAnswered(
    c: ChallengeNote,
    accepted: boolean,
    show?: { record: M.ChallengeRecordInfo | null; bonus: number },
  ): void {
    this.safely('challenge', () => {
      this.dm([c.fromUser], () => M.dmChallengeAnswer(this.lang, c.info, accepted));
      if (accepted) this.postDefault(M.challengeEmbed(this.lang, c.info, show));
    });
  }

  /** Before the lock: both managers check their lineups. */
  challengeReminder(c: ChallengeNote, lockIso: string): void {
    this.safely('challenge', () => {
      this.dm([c.fromUser], () =>
        M.dmChallengeReminder(this.lang, c.info, c.info.to ?? '', lockIso),
      );
      if (c.toUser)
        this.dm([c.toUser], () => M.dmChallengeReminder(this.lang, c.info, c.info.from, lockIso));
    });
  }

  /** No answer in time: the challenger's stake is back. */
  challengeExpired(c: ChallengeNote): void {
    this.safely('challenge', () => {
      this.dm([c.fromUser], () => M.dmChallengeExpired(this.lang, c.info));
    });
  }

  /** A booked challenge will not be played: both managers hear why. */
  challengeVoid(c: ChallengeNote, why: string | null): void {
    this.safely('challenge', () => {
      this.dm([c.fromUser], () => M.dmChallengeVoid(this.lang, c.info.to ?? '', why));
      if (c.toUser) this.dm([c.toUser], () => M.dmChallengeVoid(this.lang, c.info.from, why));
    });
  }

  /** The lock: the tournament is seeded, its match takes bets until the start. */
  challengeBetsOpen(c: ChallengeNote, tournamentId: string): void {
    this.safely('challenge', () => {
      const t = this.row(tournamentId);
      const [matchId] = this.bets.discordOpenMatches(tournamentId);
      if (!t || !matchId) return;
      this.post(t, M.challengeBetsEmbed(this.lang, c.info, this.matchLink(t, matchId)));
    });
  }

  /** The result (with the bets of its match); `tournamentId`: null when won without a game. */
  challengeResult(
    c: ChallengeNote,
    o: Omit<M.ChallengeOutcome, 'bets'>,
    tournamentId: string | null,
    matchId: string | null,
  ): void {
    this.safely('challenge', () => {
      const t = tournamentId ? this.row(tournamentId) : undefined;
      let bets: string | null = null;
      let link = c.info.link;
      if (t && matchId) {
        link = this.matchLink(t, matchId);
        const s = this.bets.discordMatch(t.id, matchId);
        const p = this.events.projection(t.id);
        if (s && p) bets = M.betsPayout(this.lang, s, this.betNames(p));
      }
      this.postDefault(M.challengeResultEmbed(this.lang, c.info, { ...o, bets }, link));
    });
  }

  /** A Monster Hunt run broke the season record of its map: the record bonus. */
  challengeRecord(r: Parameters<typeof M.challengeRecordEmbed>[1], link: string): void {
    this.safely('challenge', () => this.postDefault(M.challengeRecordEmbed(this.lang, r, link)));
  }
}
