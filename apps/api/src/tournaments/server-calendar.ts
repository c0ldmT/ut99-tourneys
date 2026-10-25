import { Injectable } from '@nestjs/common';
import type { TournamentSettings } from '@tourney/protocol';

/** A time a game server is kept free for something (the league evening). */
export interface Reservation {
  from: number;
  to: number;
  /** What it is for, shown in messages ("the league"). */
  label: string;
  /** Tournaments that may run in it (the league's own matchdays). */
  allows?(t: CalendarTournament): boolean;
}

/** What the calendar needs to know of a tournament. */
export interface CalendarTournament {
  id: string;
  agentId: string;
  kind: string;
  udtJson: string | null;
  settings: TournamentSettings;
}

/** Reservations of a server (agent) that overlap [from, to). */
export type ReservationSource = (agentId: string, from: number, to: number) => Reservation[];

/** Minutes per game and between two games (a rough plan, export of 25.10.: 4-5 min a game). */
const GAME_MIN = 5;
const BETWEEN_MIN = 1;

/** Estimated running time of a tournament in ms: its matches × best of × a game with a break. */
export function estimateMs(s: TournamentSettings): number {
  const matches =
    s.format === 'fixtures' ? s.size / 2 : s.format === 'double' ? 2 * s.size - 1 : s.size - 1;
  return matches * Math.max(1, s.bestOf?.default ?? 1) * (GAME_MIN + BETWEEN_MIN) * 60_000;
}

/**
 * Server calendar (league plan L5, risk R2): one server runs one tournament at a time, so times
 * that are reserved (the league evening, registered by the league) keep other tournaments out.
 * Creating or moving a tournament into a reservation is refused; series and autostart move a
 * start behind it instead. Nothing is reserved without a source (no league).
 */
@Injectable()
export class ServerCalendar {
  private readonly sources: ReservationSource[] = [];
  private readonly deadlines: ((t: CalendarTournament, scheduledAt: number) => number | null)[] =
    [];

  registerSource(source: ReservationSource): void {
    this.sources.push(source);
  }

  /**
   * How long an autostart tournament may wait for its server (default: an hour after its
   * start, see AUTOSTART_WAIT_MS); the league lets its matchdays wait until the day is over.
   */
  registerDeadline(fn: (t: CalendarTournament, scheduledAt: number) => number | null): void {
    this.deadlines.push(fn);
  }

  deadline(t: CalendarTournament, scheduledAt: number): number | null {
    for (const fn of this.deadlines) {
      const d = fn(t, scheduledAt);
      if (d !== null) return d;
    }
    return null;
  }

  /** Reservations of the agent within [from, to) that `t` may not run in. */
  conflicts(t: CalendarTournament, from: number, to: number): Reservation[] {
    return this.sources
      .flatMap((src) => src(t.agentId, from, to))
      .filter((r) => r.from < to && r.to > from && !r.allows?.(t))
      .sort((a, b) => a.from - b.from);
  }

  /** The first reservation `t` would run into when it starts at `start` (null: free). */
  blocking(t: CalendarTournament, start: number): Reservation | null {
    return this.conflicts(t, start, start + estimateMs(t.settings))[0] ?? null;
  }

  /** The earliest start from `start` on that runs into no reservation (a few tries). */
  nextFree(t: CalendarTournament, start: number): number {
    let at = start;
    for (let i = 0; i < 20; i++) {
      const r = this.blocking(t, at);
      if (!r) return at;
      at = r.to;
    }
    return at;
  }
}

/** "25.10. 18:00" in the season's time zone (messages about reservations). */
export function localTime(ms: number, timeZone: string): string {
  const f = new Intl.DateTimeFormat('de-DE', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return f.format(new Date(ms)).replace(',', '');
}
