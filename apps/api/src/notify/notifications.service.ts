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
import { BetsService } from '../bets/bets.service.js';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { CLOCK, CONFIG, type ApiClock, type ApiConfig } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { registrations, tournaments, users } from '../db/schema.js';
import { EventLogService } from '../tournaments/event-log.service.js';
import { DISCORD_OUT, isDiscordId, isWebhookUrl, type DiscordOut } from './discord-out.js';
import * as M from './messages.js';

type TournamentRow = typeof tournaments.$inferSelect;
type UserRow = typeof users.$inferSelect;

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
    @Inject(LOGGER) private readonly log: ApiLogger,
    @Inject(EventLogService) private readonly events: EventLogService,
    @Inject(AgentsService) private readonly agents: AgentsService,
    @Inject(DISCORD_OUT) private readonly out: DiscordOut,
    @Inject(BetsService) private readonly bets: BetsService,
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
      this.timer = setInterval(() => this.safely('reminders', () => this.remindTick()), 60_000);
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

  private post(t: TournamentRow, text: string): void {
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
      this.post(t, M.announce(this.lang, this.info(t)));
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
      const info = this.info(t);
      for (const e of stored) {
        switch (e.type) {
          case 'checkin.opened': {
            const deadline = new Date(
              Date.parse(e.at) + after.settings.checkInWindowMin * 60_000,
            ).toISOString();
            this.post(t, M.checkInOpened(this.lang, info, deadline));
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
          case 'match.started': {
            const s = this.bets.discordMatch(t.id, e.data.matchId, e.at);
            if (s) this.post(t, M.betsClosed(this.lang, s, this.betNames(after)));
            break;
          }
          case 'match.result': {
            const r = e.data.result as MatchResult;
            const s = this.bets.discordMatch(t.id, r.matchId);
            const payout = s && M.betsPayout(this.lang, s, this.betNames(after));
            const text = M.matchResult(this.lang, after, r);
            this.post(t, payout ? `${text}\n${payout}` : text);
            break;
          }
          case 'tournament.finished': {
            const s = this.bets.discordTournament(t.id);
            const summary = s && M.betsTournament(this.lang, s, this.betNames(after));
            const text = M.champion(this.lang, after, info.link);
            this.post(t, summary ? `${text}\n${summary}` : text);
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
    const link = `${this.config.publicUrl}/t/${t.id}/m/${matchId}`;
    const name = (id: string) => p.entrants[id]?.displayName ?? id;
    this.post(t, M.betsOpen(this.lang, name(a), name(b), open.windowSec, link));
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
}
