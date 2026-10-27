import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import { UdtNav } from '../core/udt';
import { hubShape, udtAreas, type UdtArea, type UdtAreaId } from '../core/udt-areas';
import type { UdtHub } from '../core/types';

/** The stage of the large hub (viewBox units; the page scales it). */
const W = 1100;
const H = 900;
/** Size of a field with an area's pages (stage units). */
const PW = 290;
const PH = 150;
/** The small hub on phones. */
const MW = 340;
const MH = 330;

const pct = (v: number, of: number) => Math.round((v / of) * 10000) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;

interface AreaView {
  area: UdtArea;
  hint: string;
  badge: string | null;
}

/**
 * The Dream Team hub (decision 228): the areas as segments of one shape - a pentagon with the
 * league, a square without - each leading to its pages (fields along the edges), with a short
 * state per area. On phones a small shape picks the area, its pages are listed below.
 */
@Component({
  selector: 'app-udt-hub',
  imports: [RouterLink, TPipe, UdtNav],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav [bare]="true" (changed)="load()" />
    <div class="hub-head">
      <h1 class="disp">{{ 'udt.title' | t }}</h1>
      <span class="muted">{{ headLine() }}</span>
    </div>

    <!-- Large screens: the shape with the fields of every area. -->
    <div class="hub-stage" [style.aspect-ratio]="ratio">
      <svg class="hub-lines" [attr.viewBox]="viewBox" aria-hidden="true">
        @for (s of segs(); track s.id) {
          <line
            [attr.x1]="s.line[0]"
            [attr.y1]="s.line[1]"
            [attr.x2]="s.line[2]"
            [attr.y2]="s.line[3]"
            [attr.stroke]="s.area.color"
            [class.hot]="hot() === s.id"
          />
          <circle [attr.cx]="s.line[0]" [attr.cy]="s.line[1]" r="4" [attr.fill]="s.area.color" />
        }
      </svg>
      @for (s of segs(); track s.id) {
        <a
          class="hub-seg"
          [routerLink]="s.area.items[0]!.link"
          [class.hot]="hot() === s.id"
          [style.clip-path]="s.clip"
          [style.background]="s.bg"
          [style.--dx.px]="s.push[0]"
          [style.--dy.px]="s.push[1]"
          (mouseenter)="hot.set(s.id)"
          (mouseleave)="hot.set(null)"
          (focus)="hot.set(s.id)"
          (blur)="hot.set(null)"
        >
          <span class="hub-lab" [style.left.%]="s.label[0]" [style.top.%]="s.label[1]">
            <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
              <path [attr.d]="s.area.icon" [attr.stroke]="s.area.color" />
            </svg>
            <b>{{ s.area.label | t }}</b>
            @if (s.view.badge; as b) {
              <span class="hub-badge" [style.background]="s.area.color">{{ b }}</span>
            }
          </span>
        </a>
      }
      <svg class="hub-edges" [attr.viewBox]="viewBox" aria-hidden="true">
        @for (s of segs(); track s.id) {
          <line
            [attr.x1]="s.spoke[0]"
            [attr.y1]="s.spoke[1]"
            [attr.x2]="s.spoke[2]"
            [attr.y2]="s.spoke[3]"
          />
        }
        <polygon [attr.points]="outline()" />
      </svg>
      <button
        type="button"
        class="hub-help"
        [style.left.%]="center()[0]"
        [style.top.%]="center()[1]"
        [attr.aria-label]="'udt.help.button' | t"
        (click)="nav().openHelp()"
      >
        <span
          ><b>?</b><small>{{ 'udt.hub.help' | t }}</small></span
        >
      </button>
      @for (s of segs(); track s.id) {
        <section
          class="hub-field"
          [class.hot]="hot() === s.id"
          [style.left.%]="s.field[0]"
          [style.top.%]="s.field[1]"
          [style.width.%]="fieldWidth"
          [style.--ac]="s.area.color"
          [style.--acr]="s.area.rgb"
          [attr.aria-label]="s.area.label | t"
          (mouseenter)="hot.set(s.id)"
          (mouseleave)="hot.set(null)"
        >
          <a class="hub-ftitle" [routerLink]="s.area.items[0]!.link"
            ><span class="dot" aria-hidden="true"></span>{{ s.area.label | t
            }}<span class="go" aria-hidden="true">›</span></a
          >
          <p>{{ s.view.hint }}</p>
          <div class="hub-pills">
            @for (i of s.area.items; track i.label) {
              <a class="hub-pill" [routerLink]="i.link" [fragment]="i.fragment"
                >{{ i.label | t }}
                @if (i.badge === 'trades' && tradesIn()) {
                  <span class="udt-badge">{{ tradesIn() }}</span>
                }
              </a>
            }
          </div>
        </section>
      }
    </div>

    <!-- Phones: a small shape picks the area, its pages below. -->
    <div class="hub-phone">
      <div class="hub-mini" [style.aspect-ratio]="miniRatio">
        @for (s of mini(); track s.id) {
          <button
            type="button"
            class="hub-seg"
            [class.hot]="picked() === s.id"
            [attr.aria-pressed]="picked() === s.id"
            [style.clip-path]="s.clip"
            [style.background]="s.bg"
            [style.--dx.px]="s.push[0]"
            [style.--dy.px]="s.push[1]"
            (click)="pick.set(s.id)"
          >
            <span class="hub-lab sm" [style.left.%]="s.label[0]" [style.top.%]="s.label[1]">
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path [attr.d]="s.area.icon" [attr.stroke]="s.area.color" />
              </svg>
              <b>{{ s.area.short | t }}</b>
              @if (s.view.badge; as b) {
                <span class="hub-badge" [style.background]="s.area.color">{{ b }}</span>
              }
            </span>
          </button>
        }
        <svg class="hub-edges" [attr.viewBox]="miniBox" aria-hidden="true">
          @for (s of mini(); track s.id) {
            <line
              [attr.x1]="s.spoke[0]"
              [attr.y1]="s.spoke[1]"
              [attr.x2]="s.spoke[2]"
              [attr.y2]="s.spoke[3]"
            />
          }
          <polygon [attr.points]="miniOutline()" />
        </svg>
        <button
          type="button"
          class="hub-help sm"
          [style.left.%]="miniCenter()[0]"
          [style.top.%]="miniCenter()[1]"
          [attr.aria-label]="'udt.help.button' | t"
          (click)="nav().openHelp()"
        >
          <span><b>?</b></span>
        </button>
      </div>
      @if (pickedView(); as p) {
        <section
          class="hub-card"
          [style.--ac]="p.area.color"
          [style.--acr]="p.area.rgb"
          [attr.aria-label]="p.area.label | t"
        >
          <a class="hub-ftitle" [routerLink]="p.area.items[0]!.link"
            ><span class="dot" aria-hidden="true"></span>{{ p.area.label | t
            }}<span class="go" aria-hidden="true">›</span></a
          >
          <p>{{ p.hint }}</p>
          @for (i of p.area.items; track i.label) {
            <a class="hub-row" [routerLink]="i.link" [fragment]="i.fragment"
              >{{ i.label | t }}
              @if (i.badge === 'trades' && tradesIn()) {
                <span class="udt-badge">{{ tradesIn() }}</span>
              }
              <span class="go" aria-hidden="true">›</span></a
            >
          }
        </section>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      container-type: inline-size;
    }
    .hub-head {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 6px 14px;
      margin-bottom: 4px;
    }
    .hub-head h1 {
      margin: 0;
    }
    .hub-stage {
      position: relative;
      width: 100%;
      max-width: 1100px;
      margin: 0 auto;
    }
    .hub-phone {
      display: none;
    }
    .hub-lines,
    .hub-edges {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    .hub-lines line {
      stroke-width: 2;
      stroke-dasharray: 4 6;
      opacity: 0.5;
      transition: opacity 0.2s;
    }
    .hub-lines line.hot {
      opacity: 1;
    }
    .hub-edges line {
      stroke: var(--bg);
      stroke-width: 5;
    }
    .hub-edges polygon {
      fill: none;
      stroke: var(--line);
      stroke-width: 1.5;
    }
    .hub-seg {
      position: absolute;
      inset: 0;
      display: block;
      padding: 0;
      border: 0;
      border-radius: 0;
      color: var(--text);
      cursor: pointer;
      transition:
        transform 0.25s cubic-bezier(0.22, 1, 0.36, 1),
        filter 0.2s;
    }
    .hub-seg.hot,
    .hub-seg:focus-visible {
      transform: translate(var(--dx), var(--dy));
      filter: brightness(1.35) saturate(1.2);
    }
    .hub-seg:focus-visible {
      outline: none;
    }
    .hub-lab {
      position: absolute;
      transform: translate(-50%, -50%);
      width: 120px;
      text-align: center;
      pointer-events: none;
    }
    .hub-lab svg {
      display: block;
      margin: 0 auto 6px;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .hub-lab b {
      display: block;
      font-family: var(--font-display);
      font-size: 1.35rem;
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      line-height: 1.05;
    }
    .hub-lab.sm {
      width: 80px;
    }
    .hub-lab.sm svg {
      margin-bottom: 3px;
    }
    .hub-lab.sm b {
      font-size: 0.95rem;
    }
    .hub-badge {
      display: inline-block;
      margin-top: 6px;
      padding: 0 9px;
      border-radius: 999px;
      color: var(--bg);
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .hub-help {
      position: absolute;
      transform: translate(-50%, -50%);
      width: 96px;
      height: 111px;
      padding: 2px;
      border: 0;
      border-radius: 0;
      clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
      background: var(--udt);
      color: var(--text);
      cursor: pointer;
      transition: filter 0.15s;
    }
    .hub-help > span {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      clip-path: inherit;
      background: linear-gradient(160deg, var(--panel-3), var(--bg-2));
    }
    .hub-help b {
      font-family: var(--font-display);
      font-size: 1.9rem;
      line-height: 1;
    }
    .hub-help small {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .hub-help:hover,
    .hub-help:focus-visible {
      filter: brightness(1.25);
    }
    /* The outline would be clipped: a ring inside the hexagon. */
    .hub-help:focus-visible > span {
      outline: 2px solid var(--accent);
      outline-offset: -6px;
    }
    .hub-seg:focus-visible .hub-lab b {
      text-decoration: underline;
      text-decoration-color: var(--accent);
      text-underline-offset: 4px;
    }
    .hub-help.sm {
      width: 56px;
      height: 65px;
    }
    .hub-help.sm b {
      font-size: 1.4rem;
    }
    .hub-field,
    .hub-card {
      border-radius: var(--radius);
      background: var(--panel);
      border: 1px solid var(--line);
      padding: 12px 14px;
      transition:
        border-color 0.2s,
        box-shadow 0.2s;
    }
    .hub-field {
      position: absolute;
      transform: translate(-50%, -50%);
    }
    .hub-field.hot,
    .hub-field:focus-within {
      border-color: var(--ac);
      box-shadow: 0 0 0 4px rgba(var(--acr), 0.14);
    }
    .hub-ftitle {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text);
      font-family: var(--font-display);
      font-weight: 700;
      font-size: 1.2rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .hub-ftitle .dot {
      width: 10px;
      height: 10px;
      border-radius: 3px;
      background: var(--ac);
    }
    .go {
      margin-left: auto;
      color: var(--faint);
      font-family: var(--font);
    }
    .hub-field p,
    .hub-card p {
      margin: 4px 0 10px;
      color: var(--text-2);
      font-size: 0.84rem;
      line-height: 1.35;
    }
    .hub-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .hub-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 32px;
      padding: 4px 12px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--panel-2);
      color: var(--text-2);
      font-size: 0.88rem;
      font-weight: 600;
    }
    .hub-pill:hover {
      background: var(--panel-3);
      color: var(--text);
    }
    .hub-card {
      margin-top: 14px;
      border-color: var(--ac);
      box-shadow: 0 0 0 4px rgba(var(--acr), 0.12);
      padding-bottom: 4px;
    }
    .hub-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 46px;
      border-top: 1px solid var(--border);
      color: var(--text);
      font-weight: 600;
    }
    .hub-mini {
      position: relative;
      width: 100%;
      max-width: 360px;
      margin: 0 auto;
    }
    /* Too narrow for the fields: the small shape with a list. */
    @container (max-width: 1000px) {
      .hub-stage {
        display: none;
      }
      .hub-phone {
        display: block;
      }
    }
  `,
})
export class UdtHubPage {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly i18n = inject(I18n);
  protected readonly nav = viewChild.required(UdtNav);

  protected readonly hub = signal<UdtHub | null>(null);
  /** The area under the pointer or the keyboard (segment and field light up together). */
  protected readonly hot = signal<UdtAreaId | null>(null);
  /** Phones: the area picked (first: the league on a match day, else my team). */
  protected readonly pick = signal<UdtAreaId | null>(null);

  protected readonly ratio = `${W} / ${H}`;
  protected readonly miniRatio = `${MW} / ${MH}`;
  protected readonly viewBox = `0 0 ${W} ${H}`;
  protected readonly miniBox = `0 0 ${MW} ${MH}`;
  protected readonly fieldWidth = pct(PW, W);

  protected readonly areas = computed(() =>
    udtAreas(!!this.auth.config().udtLeague || !!this.hub()?.league.visible),
  );
  protected readonly tradesIn = computed(() => this.hub()?.transfers.tradesIn ?? 0);

  private readonly views = computed(() => {
    const out = new Map<UdtAreaId, AreaView>();
    for (const a of this.areas()) out.set(a.id, { area: a, ...this.state(a.id) });
    return out;
  });

  private readonly shape = computed(() => {
    const n = this.areas().length;
    const r = n > 4 ? 240 : 280;
    // Room above and below for fields that grow with their text.
    const c = { x: W / 2, y: n === 3 ? 490 : n === 5 ? 460 : 450 };
    return { c, ...hubShape(n, c, r) };
  });

  protected readonly segs = computed(() => {
    const { c, segments } = this.shape();
    const r = segments.length > 4 ? 240 : 280;
    const apothem = r * Math.cos(Math.PI / segments.length);
    return this.areas().map((area, k) => {
      const s = segments[k]!;
      const [, p, q] = s.points;
      const ext = Math.abs(s.normal.x) * (PW / 2) + Math.abs(s.normal.y) * (PH / 2);
      const dist = apothem + 44 + ext;
      const f = { x: c.x + s.normal.x * dist, y: c.y + s.normal.y * dist };
      return {
        id: area.id,
        area,
        view: this.views().get(area.id)!,
        clip: this.clip([c, p, q], W, H),
        bg: this.gradient(s.normal, area.rgb),
        push: [r1(s.normal.x * 8), r1(s.normal.y * 8)],
        label: [pct(s.centroid.x, W), pct(s.centroid.y, H)],
        field: [pct(f.x, W), pct(f.y, H)],
        line: [
          r1(s.mid.x + s.normal.x * 6),
          r1(s.mid.y + s.normal.y * 6),
          r1(f.x - s.normal.x * ext),
          r1(f.y - s.normal.y * ext),
        ],
        spoke: [r1(c.x), r1(c.y), r1(p.x), r1(p.y)],
      };
    });
  });

  protected readonly outline = computed(() =>
    this.shape()
      .corners.map((p) => `${r1(p.x)},${r1(p.y)}`)
      .join(' '),
  );
  protected readonly center = computed(() => {
    const { c } = this.shape();
    return [pct(c.x, W), pct(c.y, H)];
  });

  private readonly miniShape = computed(() => {
    const n = this.areas().length;
    const c = { x: MW / 2, y: n === 3 ? 190 : n === 5 ? 175 : 165 };
    return { c, ...hubShape(n, c, n > 4 ? 150 : 165) };
  });

  protected readonly mini = computed(() => {
    const { c, segments } = this.miniShape();
    return this.areas().map((area, k) => {
      const s = segments[k]!;
      const [, p, q] = s.points;
      const on = this.picked() === area.id;
      return {
        id: area.id,
        area,
        view: this.views().get(area.id)!,
        clip: this.clip([c, p, q], MW, MH),
        bg: this.gradient(s.normal, area.rgb, on),
        push: [r1(s.normal.x * 6), r1(s.normal.y * 6)],
        label: [pct(s.centroid.x, MW), pct(s.centroid.y, MH)],
        spoke: [r1(c.x), r1(c.y), r1(p.x), r1(p.y)],
      };
    });
  });

  protected readonly miniOutline = computed(() =>
    this.miniShape()
      .corners.map((p) => `${r1(p.x)},${r1(p.y)}`)
      .join(' '),
  );
  protected readonly miniCenter = computed(() => {
    const { c } = this.miniShape();
    return [pct(c.x, MW), pct(c.y, MH)];
  });

  protected readonly picked = computed((): UdtAreaId => {
    const p = this.pick();
    if (p && this.areas().some((a) => a.id === p)) return p;
    const next = this.hub()?.league.next;
    return next && this.isToday(next.at) && this.areas().some((a) => a.id === 'league')
      ? 'league'
      : 'team';
  });
  protected readonly pickedView = computed(() => this.views().get(this.picked()) ?? null);

  protected readonly headLine = computed(() => {
    const h = this.hub();
    if (!h) return '';
    const season = h.season !== null ? `Season ${h.season}` : this.i18n.t('udt.hub.noSeason');
    return h.team ? `${h.team.name} · ${season}` : season;
  });

  constructor() {
    void this.load();
  }

  protected async load() {
    try {
      this.hub.set(await this.api.udtHub());
    } catch {
      // the toast shows the error
    }
  }

  /** A polygon as clip-path in % of the stage. */
  private clip(points: { x: number; y: number }[], w: number, h: number): string {
    return `polygon(${points.map((p) => `${pct(p.x, w)}% ${pct(p.y, h)}%`).join(', ')})`;
  }

  /** The segment's tint, stronger towards its edge. */
  private gradient(n: { x: number; y: number }, rgb: string, on = false): string {
    const deg = r1((Math.atan2(n.x, -n.y) * 180) / Math.PI);
    return `linear-gradient(${deg}deg, rgba(${rgb},${on ? 0.14 : 0.05}) 30%, rgba(${rgb},${on ? 0.45 : 0.22}))`;
  }

  private isToday(iso: string): boolean {
    const d = new Date(iso);
    const n = new Date();
    return d.toDateString() === n.toDateString();
  }

  /** "today 20:00", "tomorrow 18:00", "Thu 18:00". */
  private when(iso: string): string {
    const d = new Date(iso);
    const loc = this.i18n.lang() === 'de' ? 'de-DE' : 'en-GB';
    const time = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
    const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(d) - day(new Date())) / 86_400_000);
    if (diff === 0) return this.i18n.t('udt.hub.today', { t: time });
    if (diff === 1) return this.i18n.t('udt.hub.tomorrow', { t: time });
    // Within the week the weekday, else with the date.
    const date =
      diff > 1 && diff < 7
        ? d.toLocaleDateString(loc, { weekday: 'short' })
        : d.toLocaleDateString(loc, { weekday: 'short', day: '2-digit', month: '2-digit' });
    return `${date} ${time}`;
  }

  /** The short state of an area and its badge. */
  private state(id: UdtAreaId): { hint: string; badge: string | null } {
    const t = (k: string, p?: Record<string, string | number>) => this.i18n.t(k, p);
    const h = this.hub();
    if (!h) return { hint: '', badge: null };
    switch (id) {
      case 'team': {
        const m = h.team;
        if (!m) return { hint: t('udt.hub.team.none'), badge: null };
        const parts: string[] = [];
        if (m.points) parts.push(t('udt.hub.team.points', { n: m.points }));
        if (m.striking) parts.push(t('udt.hub.team.striking', { n: m.striking }));
        if (m.tired) parts.push(t('udt.hub.team.tired', { n: m.tired }));
        if (m.lineup < 5) parts.push(t('udt.hub.team.lineup', { n: m.lineup }));
        return {
          hint: parts.slice(0, 2).join(' · ') || t('udt.hub.team.ready'),
          badge: m.points ? String(m.points) : null,
        };
      }
      case 'league': {
        const l = h.league;
        if (l.next) {
          const what =
            l.next.kind === 'league'
              ? t('udt.hub.league.matchday', { n: l.next.matchday ?? 0 })
              : t(`league.kind.${l.next.kind}`);
          const place =
            l.place !== null && l.tier !== null
              ? ' · ' +
                t('udt.hub.league.place', {
                  n: l.place,
                  tier: l.tier === 0 ? 'Pro Series' : t('league.division', { n: l.tier }),
                })
              : '';
          return {
            hint:
              t('udt.hub.league.next', {
                when: this.when(l.next.at),
                what,
                opp: l.next.opponent,
              }) + place,
            badge: this.isToday(l.next.at) ? t('udt.hub.todayBadge') : null,
          };
        }
        return { hint: t(l.running ? 'udt.hub.league.done' : 'udt.hub.league.wait'), badge: null };
      }
      case 'packs': {
        const p = h.packs;
        return {
          hint: p
            ? t('udt.hub.packs.state', { n: p.traits, l: Math.max(1, p.legendaryIn) })
            : t('udt.hub.packs.none'),
          badge: null,
        };
      }
      case 'cups': {
        const c = h.cups;
        if (!c) return { hint: t('udt.hub.cups.none'), badge: null };
        if (c.live) return { hint: t('udt.hub.cups.live'), badge: 'Live' };
        if (c.next) {
          const at = c.next.at ? ` · ${this.when(c.next.at)}` : '';
          const state = c.next.entered
            ? t('udt.hub.cups.entered')
            : c.open
              ? t('udt.hub.cups.open')
              : '';
          return {
            hint: `${c.next.name}${at}${state ? ' · ' + state : ''}`,
            badge: null,
          };
        }
        return { hint: t('udt.hub.cups.none'), badge: null };
      }
      case 'trans': {
        const x = h.transfers;
        const parts: string[] = [];
        if (x.tradesIn) parts.push(t('udt.hub.trans.trades', { n: x.tradesIn }));
        if (x.marketAt) parts.push(t('udt.hub.trans.market', { when: this.when(x.marketAt) }));
        return {
          hint: parts.join(' · ') || t('udt.hub.trans.none'),
          badge: x.tradesIn ? String(x.tradesIn) : null,
        };
      }
    }
  }
}
