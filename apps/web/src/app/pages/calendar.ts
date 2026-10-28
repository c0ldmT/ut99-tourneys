import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { I18n, TPipe } from '../core/i18n';
import type { CalendarItem, CalendarKind, CalendarView } from '../core/types';

type Group = 'all' | 'tour' | 'cup' | 'league' | 'season';
type Mode = 'month' | 'list';

const GROUP: Record<CalendarKind, Exclude<Group, 'all'>> = {
  tournament: 'tour',
  cup: 'cup',
  leagueEvening: 'league',
  relegation: 'league',
  finalFour: 'league',
  seasonStart: 'season',
  seasonEnd: 'season',
  keepers: 'season',
  payday: 'season',
};

/** Icons (24 × 24, stroke) per group. */
const ICON: Record<Exclude<Group, 'all'> | 'pay', string> = {
  tour: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  cup: 'M7 4h10v5a5 5 0 0 1-10 0zM5 5H3v2a4 4 0 0 0 4 4M19 5h2v2a4 4 0 0 1-4 4M12 14v4M8 21h8',
  league: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  season: 'M5 21V4h11l-2 4 2 4H5',
  pay: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 6.5v11M15 9.5h-4a1.5 1.5 0 0 0 0 3h2a1.5 1.5 0 0 1 0 3H9',
};

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** 0 = Monday. */
const weekday = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
const diffDays = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

interface Shown {
  item: CalendarItem;
  /** Colour group (payday has its own colour). */
  tone: Exclude<Group, 'all'> | 'pay';
  icon: string;
  time: string;
  title: string;
  short: string;
  sub: string;
  myLine: string;
  badges: { label: string; cls: string }[];
}

interface Cell {
  day: string;
  num: number;
  inMonth: boolean;
  today: boolean;
  season: number | null;
  /** Label in the season band (first day of a season, the first cell). */
  band: string;
  dayNo: string;
  keepers: boolean;
  items: Shown[];
  aria: string;
}

/**
 * The calendar (decision 231): what is on when - tournaments and Dream Team cups (with the
 * planned starts of the series), the league's evenings, relegation and final four (before the
 * league starts: its plan), seasons with their keeper window, the Mondays with table money. A
 * month as a grid (phones: dots) with the chosen day beside or below it, or a list; filters like
 * the Matches page and "only mine"; three cards with what comes next.
 */
@Component({
  selector: 'app-calendar',
  imports: [NgTemplateOutlet, RouterLink, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cal-head">
      <div>
        @if (seasonLine(); as s) {
          <div class="cal-eyebrow">{{ s }}</div>
        }
        <h1>{{ 'cal.title' | t }}</h1>
      </div>
      <span class="grow"></span>
      <div class="seg" role="radiogroup" [attr.aria-label]="'cal.view' | t">
        @for (m of modes; track m) {
          <button
            type="button"
            role="radio"
            [class.on]="mode() === m"
            [attr.aria-checked]="mode() === m"
            (click)="mode.set(m)"
          >
            {{ 'cal.mode.' + m | t }}
          </button>
        }
      </div>
      <div class="cal-nav">
        <button type="button" class="btn" [attr.aria-label]="'cal.prev' | t" (click)="move(-1)">
          ‹
        </button>
        <b class="cal-month" aria-live="polite">{{ monthTitle() }}</b>
        <button type="button" class="btn" [attr.aria-label]="'cal.next' | t" (click)="move(1)">
          ›
        </button>
        <button type="button" class="btn" (click)="goToday()">{{ 'cal.today' | t }}</button>
      </div>
    </div>

    @if (upNext().length) {
      <section class="cal-next" [attr.aria-label]="'cal.upNext' | t">
        @for (n of upNext(); track n.item.id) {
          <a class="cal-card" [attr.data-tone]="n.tone" [routerLink]="n.item.link ?? null">
            <span class="cal-tile" aria-hidden="true"
              ><svg viewBox="0 0 24 24"><path [attr.d]="n.icon" /></svg
            ></span>
            <span class="cal-cardtext">
              <span class="cal-kick">{{ n.kicker }}</span>
              <b>{{ n.title }}</b>
              <span class="small muted">{{ n.sub }}</span>
            </span>
          </a>
        }
      </section>
    }

    <div class="cal-filters">
      <div class="pills" role="group" [attr.aria-label]="'cal.kind' | t">
        @for (g of groups(); track g) {
          <button
            type="button"
            [class.on]="group() === g"
            [attr.aria-pressed]="group() === g"
            (click)="group.set(g)"
          >
            @if (g !== 'all') {
              <span class="cal-dot" [attr.data-tone]="g" aria-hidden="true"></span>
            }
            {{ 'cal.group.' + g | t }}
          </button>
        }
      </div>
      <span class="grow"></span>
      <label class="switch"
        ><input type="checkbox" [checked]="mine()" (change)="mine.set(!mine())" /><span
          class="tr"
        ></span
        >{{ 'cal.mine' | t }}</label
      >
    </div>

    <div class="cal-body">
      @if (mode() === 'month') {
        <section class="cal-grid" [attr.aria-label]="monthTitle()">
          @for (w of weekdays(); track $index) {
            <span class="cal-wd" aria-hidden="true">{{ w }}</span>
          }
          @for (c of cells(); track c.day) {
            <button
              type="button"
              class="cal-day"
              [class.out]="!c.inMonth"
              [class.sel]="c.day === selected()"
              [class.past]="c.day < today()"
              [attr.aria-pressed]="c.day === selected()"
              [attr.aria-label]="c.aria"
              (click)="selected.set(c.day)"
              (keydown)="gridKey($event, c.day)"
            >
              <span
                class="cal-band"
                [class.s]="c.season !== null"
                [class.cur]="c.season === currentSeason()"
                [class.keep]="c.keepers"
                >{{ c.band }}</span
              >
              <span class="cal-num"
                ><span [class.cal-today]="c.today">{{ c.num }}</span>
                @if (c.dayNo) {
                  <span class="mono">{{ c.dayNo }}</span>
                }
              </span>
              <span class="cal-chips">
                @for (x of c.items.slice(0, 3); track x.item.id) {
                  <span
                    class="cal-chip"
                    [attr.data-tone]="x.tone"
                    [class.proj]="x.item.state === 'projected'"
                    [class.done]="x.item.state === 'done' || x.item.state === 'cancelled'"
                    [class.mine]="x.item.mine"
                    ><span class="cal-dot" [attr.data-tone]="x.tone"></span
                    ><span class="mono">{{ x.item.at ? x.time : '' }}</span
                    ><span class="cal-ct">{{ x.short }}</span>
                  </span>
                }
                @if (c.items.length > 3) {
                  <span class="cal-more">{{ 'cal.more' | t: { n: c.items.length - 3 } }}</span>
                }
              </span>
            </button>
          }
        </section>
        <aside class="cal-side" [attr.aria-label]="selectedTitle()">
          <div class="cal-eyebrow">{{ selectedSeason() }}</div>
          <h2>{{ selectedTitle() }}</h2>
          @for (x of selectedItems(); track x.item.id) {
            <ng-container *ngTemplateOutlet="entry; context: { $implicit: x }" />
          } @empty {
            <p class="cal-empty muted small">{{ 'cal.none' | t }}</p>
          }
          <p class="small muted cal-legend">
            <span class="cal-dash" aria-hidden="true"></span>{{ 'cal.legend' | t }}
          </p>
        </aside>
      } @else {
        <section class="cal-list" [attr.aria-label]="monthTitle()">
          @for (g of listDays(); track g.day) {
            <div class="cal-lday" [class.today]="g.day === today()">
              <div class="cal-lhead">
                <b>{{ g.title }}</b
                ><span class="small muted">{{ g.season }}</span>
              </div>
              @for (x of g.items; track x.item.id) {
                <ng-container *ngTemplateOutlet="entry; context: { $implicit: x }" />
              }
            </div>
          } @empty {
            <p class="cal-empty muted">{{ 'cal.noneMonth' | t }}</p>
          }
        </section>
      }
    </div>

    <ng-template #entry let-x>
      <div
        class="cal-entry"
        [attr.data-tone]="x.tone"
        [class.proj]="x.item.state === 'projected'"
        [class.done]="x.item.state === 'done' || x.item.state === 'cancelled'"
      >
        <span class="cal-tile" aria-hidden="true"
          ><svg viewBox="0 0 24 24"><path [attr.d]="x.icon" /></svg
        ></span>
        <span class="cal-etext">
          <span class="cal-etop"
            ><span class="mono small">{{ x.time }}</span>
            <span class="cal-badges">
              @for (b of x.badges; track b.label) {
                <span [class]="'cal-badge ' + b.cls">{{ b.label }}</span>
              }
            </span></span
          >
          @if (x.item.link) {
            <a class="cal-etitle" [routerLink]="x.item.link">{{ x.title }}</a>
          } @else {
            <b class="cal-etitle">{{ x.title }}</b>
          }
          @if (x.sub) {
            <span class="small muted">{{ x.sub }}</span>
          }
          @if (x.myLine) {
            <span class="small cal-my">{{ x.myLine }}</span>
          }
        </span>
      </div>
    </ng-template>
  `,
})
export class CalendarPage {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  protected readonly modes: Mode[] = ['month', 'list'];
  /** The month shown ("YYYY-MM"); empty until the first answer gives today. */
  protected readonly month = signal('');
  protected readonly mode = signal<Mode>(
    typeof matchMedia === 'function' && matchMedia('(max-width: 899px)').matches ? 'list' : 'month',
  );
  protected readonly group = signal<Group>('all');
  protected readonly mine = signal(false);
  protected readonly selected = signal('');
  protected readonly view = signal<CalendarView | null>(null);
  /** The first answer (a week back, six weeks on): what comes next, whatever month is shown. */
  private readonly ahead = signal<CalendarView | null>(null);
  private seq = 0;

  protected readonly today = computed(() => this.view()?.today ?? '');

  protected readonly groups = computed((): Group[] =>
    this.view()?.udt ? ['all', 'tour', 'cup', 'league', 'season'] : ['all', 'tour', 'season'],
  );

  /** First day of the grid (the Monday on or before the 1st) and its 42 days. */
  private readonly gridFrom = computed(() => {
    const m = this.month();
    if (!m) return '';
    const first = `${m}-01`;
    return addDays(first, -weekday(first));
  });

  protected readonly weekdays = computed(() => {
    const loc = this.locale();
    // 2024-01-01 was a Monday.
    return Array.from({ length: 7 }, (_, i) =>
      new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(loc, {
        weekday: 'short',
        timeZone: 'UTC',
      }),
    );
  });

  protected readonly monthTitle = computed(() => {
    const m = this.month();
    if (!m) return '';
    return new Date(`${m}-15T12:00:00Z`).toLocaleDateString(this.locale(), {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  });

  protected readonly currentSeason = computed(() => {
    const v = this.view();
    return v?.seasons.find((s) => s.startDate <= v.today && s.endDate >= v.today)?.number ?? null;
  });

  protected readonly seasonLine = computed(() => {
    const v = this.view();
    if (!v) return '';
    const s = v.seasons.find((x) => x.startDate <= v.today && x.endDate >= v.today);
    if (!s) return '';
    return this.i18n.t('cal.seasonLeft', { s: s.number, d: diffDays(v.today, s.endDate) });
  });

  /** The items after filters, as shown. */
  private readonly shown = computed((): Shown[] => {
    const v = this.view();
    if (!v) return [];
    const g = this.group();
    const mine = this.mine();
    this.i18n.lang();
    return v.items
      .filter(
        (i) =>
          (g === 'all' || GROUP[i.kind] === g) && (!mine || i.mine || GROUP[i.kind] === 'season'),
      )
      .map((i) => this.show(i));
  });

  private readonly byDay = computed(() => {
    const out = new Map<string, Shown[]>();
    for (const x of this.shown()) {
      const list = out.get(x.item.day) ?? [];
      list.push(x);
      out.set(x.item.day, list);
    }
    return out;
  });

  protected readonly cells = computed((): Cell[] => {
    const from = this.gridFrom();
    const v = this.view();
    if (!from || !v) return [];
    const m = this.month();
    const loc = this.locale();
    return Array.from({ length: 42 }, (_, n) => {
      const day = addDays(from, n);
      const s = v.seasons.find((x) => x.startDate <= day && x.endDate >= day) ?? null;
      const no = s ? diffDays(s.startDate, day) + 1 : 0;
      const items = this.byDay().get(day) ?? [];
      const keepers = v.items.some(
        (i) => i.kind === 'keepers' && i.day <= day && String(i.meta.until ?? '') >= day,
      );
      const label = new Date(`${day}T12:00:00Z`).toLocaleDateString(loc, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      });
      return {
        day,
        num: Number(day.slice(8)),
        inMonth: day.startsWith(m),
        today: day === v.today,
        season: s?.number ?? null,
        band: s && (no === 1 || n === 0) ? this.i18n.t('season.label', { n: s.number }) : '',
        dayNo: s && (no === 1 || weekday(day) === 0) ? this.i18n.t('cal.dayNo', { n: no }) : '',
        keepers,
        items,
        aria: `${label}, ${this.i18n.t('cal.count', { n: items.length })}`,
      };
    });
  });

  protected readonly selectedItems = computed(() => this.byDay().get(this.selected()) ?? []);

  protected readonly selectedTitle = computed(() => {
    const d = this.selected();
    if (!d) return '';
    const t = new Date(`${d}T12:00:00Z`).toLocaleDateString(this.locale(), {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      timeZone: 'UTC',
    });
    return d === this.today() ? `${t} · ${this.i18n.t('cal.today')}` : t;
  });

  protected readonly selectedSeason = computed(() => this.seasonOf(this.selected()));

  /** The month as a list: the days with items, in order. */
  protected readonly listDays = computed(() => {
    const m = this.month();
    const loc = this.locale();
    return [...this.byDay().entries()]
      .filter(([d]) => d.startsWith(m))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, items]) => ({
        day,
        title:
          new Date(`${day}T12:00:00Z`).toLocaleDateString(loc, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            timeZone: 'UTC',
          }) + (day === this.today() ? ` · ${this.i18n.t('cal.today')}` : ''),
        season: this.seasonOf(day),
        items,
      }));
  });

  /** What comes next: the league (own game or start), a tournament or cup, the season. */
  protected readonly upNext = computed(() => {
    const v = this.ahead();
    if (!v) return [];
    const now = v.now;
    const ahead = v.items.filter(
      (i) =>
        (i.until ?? i.at ?? `${i.day}T23:59`) >= now &&
        i.state !== 'done' &&
        i.state !== 'cancelled',
    );
    const pick = [
      ahead.find((i) => GROUP[i.kind] === 'league' && i.kind !== 'payday' && i.mine) ??
        ahead.find((i) => i.kind === 'leagueEvening' && i.meta['start']),
      ahead.find((i) => (i.kind === 'tournament' || i.kind === 'cup') && i.mine) ??
        ahead.find((i) => (i.kind === 'tournament' || i.kind === 'cup') && i.state === 'open'),
      ahead.find((i) => i.kind === 'seasonEnd' || i.kind === 'seasonStart'),
    ];
    return pick
      .filter((i): i is CalendarItem => !!i)
      .map((i) => {
        const x = this.show(i);
        const days = diffDays(v.today, i.day);
        const when = days === 0 ? this.i18n.t('cal.today') : this.i18n.t('cal.inDays', { n: days });
        const kind =
          i.kind === 'leagueEvening' && !i.mine
            ? this.i18n.t('cal.next.leagueStart')
            : GROUP[i.kind] === 'league'
              ? this.i18n.t('cal.next.myGame')
              : GROUP[i.kind] === 'season'
                ? this.i18n.t('cal.next.season')
                : i.mine
                  ? this.i18n.t('cal.next.mine')
                  : this.i18n.t('cal.next.open');
        return {
          ...x,
          kicker: `${kind} · ${when}`,
          title: `${this.dayShort(i.day)}${i.at ? ` · ${x.time}` : ''} · ${x.title}`,
          sub: x.myLine || x.sub,
        };
      });
  });

  constructor() {
    void this.load();
  }

  private locale(): string {
    return this.i18n.lang() === 'de' ? 'de-DE' : 'en-GB';
  }

  private async load() {
    const seq = ++this.seq;
    const from = this.gridFrom();
    try {
      const v = await this.api.calendar(from || undefined, from ? addDays(from, 41) : undefined);
      if (seq !== this.seq) return;
      if (!this.month()) {
        // First load: the month of today (the grid around it is loaded next).
        this.ahead.set(v);
        this.month.set(v.today.slice(0, 7));
        this.selected.set(v.today);
        void this.load();
        return;
      }
      this.view.set(v);
    } catch {
      // the toast shows the error
    }
  }

  protected move(d: number) {
    const [y, m] = this.month().split('-').map(Number) as [number, number];
    const next = new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7);
    this.month.set(next);
    if (!this.selected().startsWith(next)) this.selected.set(`${next}-01`);
    void this.load();
  }

  protected goToday() {
    const t = this.today();
    if (!t) return;
    const changed = !t.startsWith(this.month());
    this.month.set(t.slice(0, 7));
    this.selected.set(t);
    if (changed) void this.load();
  }

  /** Arrow keys move the chosen day (a day, a week); leaving the month turns the page. */
  protected gridKey(e: KeyboardEvent, day: string) {
    const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key as string] ?? 0;
    if (!d) return;
    e.preventDefault();
    const next = addDays(day, d);
    this.selected.set(next);
    if (!next.startsWith(this.month())) {
      this.month.set(next.slice(0, 7));
      void this.load();
    }
    setTimeout(() => (document.querySelector('.cal-day.sel') as HTMLElement | null)?.focus());
  }

  private seasonOf(day: string): string {
    const v = this.view();
    const s = v?.seasons.find((x) => x.startDate <= day && x.endDate >= day);
    return s
      ? this.i18n.t('cal.seasonDay', { s: s.number, n: diffDays(s.startDate, day) + 1 })
      : day
        ? this.i18n.t('cal.between')
        : '';
  }

  private dayShort(day: string): string {
    return new Date(`${day}T12:00:00Z`).toLocaleDateString(this.locale(), {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      timeZone: 'UTC',
    });
  }

  private time(iso: string | null): string {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString(this.locale(), {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: this.view()?.timeZone,
    });
  }

  private show(i: CalendarItem): Shown {
    const t = (k: string, p?: Record<string, string | number>) => this.i18n.t(k, p);
    const m = i.meta as Record<string, unknown>;
    const g = GROUP[i.kind];
    const tone = i.kind === 'payday' ? 'pay' : g;
    const mds = (m['matchdays'] as number[] | undefined) ?? [];
    const md = mds.length > 1 ? `${mds[0]}–${mds.at(-1)}` : String(mds[0] ?? '');
    const season = Number(m['season'] ?? 0);
    let title = i.title ?? '';
    let short = i.title ?? '';
    let sub = '';
    switch (i.kind) {
      case 'seasonStart':
        title = t('cal.k.seasonStart', { s: season });
        short = t('cal.s.seasonStart', { s: season });
        break;
      case 'seasonEnd':
        title = t('cal.k.seasonEnd', { s: season });
        short = t('cal.s.seasonEnd', { s: season });
        sub = t('cal.sub.seasonEnd');
        break;
      case 'keepers':
        title = t('cal.k.keepers');
        short = t('cal.k.keepers');
        sub = t('cal.sub.keepers', {
          d: this.dayShort(String(m['until'])),
          n: Number(m['max'] ?? 0),
        });
        break;
      case 'leagueEvening':
        title = t(m['start'] ? 'cal.k.leagueStart' : 'cal.k.evening', { md });
        short = t(m['start'] ? 'cal.s.leagueStart' : 'cal.s.evening', { md });
        sub =
          i.state === 'projected'
            ? t('cal.sub.eveningPlan')
            : t('cal.sub.evening', { n: Number(m['games'] ?? 0), until: this.time(i.until) });
        break;
      case 'relegation':
        title = short = t('cal.k.relegation');
        sub = t('cal.sub.relegation');
        break;
      case 'finalFour':
        title = short = t('cal.k.finalFour');
        sub = t('cal.sub.finalFour');
        break;
      case 'payday':
        title = short = t('cal.k.payday');
        sub = t('cal.sub.payday');
        break;
      default: {
        const size = Number(m['teamSize'] ?? 1);
        const fmt = `${size}v${size} ${m['game'] === 'mh' ? 'MH' : 'DM'}`;
        const seats = i.state === 'projected' ? '' : ` · ${m['entrants'] ?? 0}/${m['size'] ?? '?'}`;
        sub =
          (i.kind === 'cup'
            ? t('cal.sub.cup')
            : t(m['series'] ? 'cal.sub.series' : 'cal.sub.tour')) + ` · ${fmt}${seats}`;
      }
    }
    const my = m['myGame'] as { at: string; opponent: string; home: boolean } | null | undefined;
    const myLine = my
      ? t(my.home ? 'cal.myHome' : 'cal.myAway', { time: this.time(my.at), o: my.opponent })
      : i.mine && (i.kind === 'tournament' || i.kind === 'cup')
        ? t('cal.signedUp')
        : '';
    const badges: Shown['badges'] = [];
    if (i.state === 'live') badges.push({ label: t('cal.b.live'), cls: 'live' });
    if (i.state === 'open') badges.push({ label: t('cal.b.open'), cls: 'open' });
    if (i.state === 'projected') badges.push({ label: t('cal.b.projected'), cls: 'proj' });
    if (i.state === 'cancelled') badges.push({ label: t('cal.b.cancelled'), cls: 'off' });
    if (m['test']) badges.push({ label: t('cal.b.test'), cls: 'gold' });
    if (i.mine && g !== 'league') badges.push({ label: t('cal.b.mine'), cls: 'mine' });
    return {
      item: i,
      tone,
      icon: ICON[tone],
      time: i.at ? this.time(i.at) : t('cal.allDay'),
      title,
      short,
      sub,
      myLine,
      badges,
    };
  }
}
