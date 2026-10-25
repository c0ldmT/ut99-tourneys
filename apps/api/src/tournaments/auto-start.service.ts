import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { UsersService, type User } from '../auth/users.service.js';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { CLOCK, type ApiClock } from '../config.js';
import { TournamentsService, type TournamentRow } from './tournaments.service.js';

/** How long a tournament waits for a free (online) server before it is called off. */
export const AUTOSTART_WAIT_MS = 60 * 60_000;

/**
 * Autostart (series of bot tournaments and the like): at its start time a tournament is seeded
 * (strongest meet late) and started; registered players take part, bots fill the rest. While
 * the server is busy or offline it waits, at most an hour; then it is called off.
 */
@Injectable()
export class AutoStartService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private busy = false;
  /** Last reason a tournament could not start yet (logged once per change). */
  private readonly waiting = new Map<string, string>();
  /** The end of the reservation a tournament waited behind (its hour of waiting starts there). */
  private readonly reserved = new Map<string, number>();

  constructor(
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(LOGGER) private readonly log: ApiLogger,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(TournamentsService) private readonly tournaments: TournamentsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), 30_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private actor(t: TournamentRow): User | undefined {
    return this.users.byId(t.createdBy) ?? this.users.list().find((u) => u.isAdmin);
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = this.clock.now();
      for (const t of this.tournaments.dueAutoStarts(now)) await this.step(t, now);
    } finally {
      this.busy = false;
    }
  }

  private async step(t: TournamentRow, now: number): Promise<void> {
    const by = this.actor(t);
    if (!by) return;
    const view = this.tournaments.calendarView({ ...t, settings: this.tournaments.settings(t) });
    // A reservation of the server (the league evening) comes first: the start waits behind it
    // and the hour of waiting counts from its end.
    const r = this.tournaments.calendar.blocking(view, now);
    if (r) {
      const why = `the server is reserved for ${r.label} until ${new Date(r.to).toISOString()}`;
      if (this.waiting.get(t.id) !== why) {
        this.waiting.set(t.id, why);
        this.log.info(`autostart ${t.id} waits: ${why}`);
      }
      this.reserved.set(t.id, r.to);
      return;
    }
    const start = Math.max(Date.parse(t.scheduledAt!), this.reserved.get(t.id) ?? 0);
    // The league lets its matchdays wait longer (until the evening is over).
    const deadline = this.tournaments.calendar.deadline(view, start) ?? start + AUTOSTART_WAIT_MS;
    try {
      if (t.phase === 'draft') {
        this.tournaments.seed(t.id, { mode: 'auto', humanOrder: 'rating' }, by);
        this.log.info(`autostart ${t.id}: seeded`);
      }
      await this.tournaments.run(t.id);
      this.waiting.delete(t.id);
      this.reserved.delete(t.id);
      this.log.info(`autostart ${t.id}: started`);
    } catch (e) {
      const why = (e as Error).message;
      if (this.waiting.get(t.id) !== why) {
        this.waiting.set(t.id, why);
        this.log.info(`autostart ${t.id} waits: ${why}`);
      }
      if (now < deadline) return;
      this.waiting.delete(t.id);
      this.reserved.delete(t.id);
      const phase = this.tournaments.require(t.id).phase;
      if (phase === 'seeded') {
        this.tournaments.cancelSeeded(t.id, `no free server for an hour (${why})`, by);
        this.log.warn(`autostart ${t.id}: called off after an hour (${why})`);
      } else if (phase === 'draft') {
        this.tournaments.stopAutoStart(t.id);
        this.log.warn(
          `autostart ${t.id}: could not be seeded for an hour (${why}), left to an admin`,
        );
      }
    }
  }
}
