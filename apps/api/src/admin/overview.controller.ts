import { Controller, Get, Inject } from '@nestjs/common';
import { and, desc, gte, inArray } from 'drizzle-orm';
import { AgentsService } from '../agents/agents.service.js';
import { AdminOnly } from '../auth/guard.js';
import { UsersService } from '../auth/users.service.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { events, tournaments } from '../db/schema.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { UdtCareerService } from '../udt/udt-career.service.js';
import { SeasonsService } from '../seasons/seasons.service.js';
import { ACTIVE_PHASES } from '../tournaments/tournaments.service.js';
import { ServerProblems } from './problems.js';

/** Days a user may be away before the overview counts them as inactive (as the user list). */
export const INACTIVE_DAYS = 30;
/** Days the paused and aborted tournaments are listed. */
export const PROBLEM_DAYS = 14;
/** Entries of the problem list. */
export const PROBLEM_ROWS = 8;

const DAY = 86_400_000;

/**
 * The administration's start page (UX wave 4, W4.5, decision 319): servers, moderation queue,
 * season, tournaments, users and the latest problems at one glance. Reads what the other admin
 * pages already show; nothing new is stored except the in-memory server problems.
 */
@AdminOnly()
@Controller('admin')
export class AdminOverviewController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(AgentsService) private readonly agents: AgentsService,
    @Inject(ModerationService) private readonly mod: ModerationService,
    @Inject(UdtCareerService) private readonly career: UdtCareerService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(ServerProblems) private readonly problems: ServerProblems,
  ) {}

  @Get('overview')
  overview() {
    const now = this.clock.now();
    const rows = this.db
      .select({
        id: tournaments.id,
        name: tournaments.name,
        phase: tournaments.phase,
        agentId: tournaments.agentId,
        registrationOpen: tournaments.registrationOpen,
        scheduledAt: tournaments.scheduledAt,
      })
      .from(tournaments)
      .all();
    const active = rows.filter((t) => ACTIVE_PHASES.includes(t.phase));
    const agents = this.agents.list().map((a) => this.agents.view(a));
    const names = new Map(agents.map((a) => [a.id, a.name]));

    const servers = agents.map((a) => {
      const playing = active.find((t) => t.agentId === a.id);
      return {
        id: a.id,
        name: a.name,
        online: a.online,
        inPool: a.inPool,
        lastSeenAt: a.lastSeenAt,
        playing: playing ? { id: playing.id, name: playing.name } : null,
      };
    });

    const upcoming = rows.filter((t) => t.phase === 'draft' || t.phase === 'seeded');
    const next = upcoming
      .filter((t) => t.scheduledAt && Date.parse(t.scheduledAt) >= now)
      .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))[0];

    const ov = this.seasons.overview();
    const season = ov.seasons.find((s) => s.number === (ov.current ?? ov.planned)) ?? null;

    const people = this.users.list().filter((u) => !u.discordId.startsWith('ai:'));
    const inactive = people.filter(
      (u) => !u.lastSeenAt || now - Date.parse(u.lastSeenAt) > INACTIVE_DAYS * DAY,
    ).length;

    const since = new Date(now - PROBLEM_DAYS * DAY).toISOString();
    const stops = this.db
      .select({
        tournamentId: events.tournamentId,
        type: events.type,
        at: events.at,
        json: events.json,
      })
      .from(events)
      .where(
        and(
          inArray(events.type, ['tournament.paused', 'tournament.aborted']),
          gte(events.at, since),
        ),
      )
      .orderBy(desc(events.at))
      .limit(PROBLEM_ROWS)
      .all();
    const byId = new Map(rows.map((t) => [t.id, t]));
    const problems = [
      ...stops.map((e) => {
        let reason = '';
        try {
          const d = (JSON.parse(e.json) as { data?: { reason?: unknown } }).data;
          reason = typeof d?.reason === 'string' ? d.reason : '';
        } catch {
          // an old row: no reason
        }
        return {
          at: e.at,
          kind: e.type === 'tournament.paused' ? ('paused' as const) : ('aborted' as const),
          text: reason,
          tournament: { id: e.tournamentId, name: byId.get(e.tournamentId)?.name ?? '' },
          server: null,
        };
      }),
      ...this.problems.list().map((p) => ({
        at: p.at,
        kind: p.kind,
        text: p.text,
        tournament: null,
        server: { id: p.agentId, name: names.get(p.agentId) ?? p.agentId },
      })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, PROBLEM_ROWS);

    return {
      servers,
      moderation: { open: this.mod.openCount() },
      /** Bots nominated for the library (decision 333). */
      graduations: this.career.nominationCount(),
      season: season
        ? {
            number: season.number,
            status: season.status,
            startDate: season.startDate,
            endDate: season.endDate,
          }
        : null,
      today: ov.today,
      tournaments: {
        live: active.length,
        open: upcoming.filter((t) => t.registrationOpen).length,
        drafts: rows.filter((t) => t.phase === 'draft').length,
        next: next ? { id: next.id, name: next.name, at: next.scheduledAt! } : null,
      },
      users: { total: people.length, inactive, inactiveDays: INACTIVE_DAYS },
      problems,
      problemDays: PROBLEM_DAYS,
    };
  }
}
