import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CREST_COLORS,
  CREST_SHAPES,
  FANSHOP_PAYS,
  roundNeuro,
  type ClubUpgrade,
} from '@tourney/udt';
import { UdtCrestMark } from '../components/udt-crest';
import { Api } from '../core/api';
import { I18n, TPipe } from '../core/i18n';
import { formatNeuro, NeuroPipe } from '../core/neuro';
import type { UdtClubUpgrade, UdtCrest, UdtTrophies, UdtView } from '../core/types';
import { UdtNav } from '../core/udt';

/** Names of the crest colours (CREST_COLORS order) for screen readers. */
const COLOR_NAMES = ['violet', 'cyan', 'gold', 'green', 'red', 'blue', 'pink', 'silver'];

/** A building with a page of its own: where its link leads. */
const LINKS: Partial<Record<ClubUpgrade, { link: string; fragment?: string }>> = {
  analysis: { link: '/udt/team' },
  trophy: { link: '/udt/club', fragment: 'trophies' },
};

interface Tile {
  b: UdtClubUpgrade;
  /** What it does now (built) or at its first level. */
  now: string;
  built: boolean;
  top: boolean;
  multi: boolean;
  pips: number[];
  note: string;
  link: { link: string; fragment?: string } | null;
}

interface WallItem {
  season: number;
  kind: 'league' | 'cup' | 'stage';
  title: string;
  sub: string;
  gold: boolean;
}

/**
 * Dream Team club house (decisions 266, 268; designs "Vereinshaus" and "Trophäenraum"): the
 * season's buildings with their levels, effects and prices, and with the trophy room the crest
 * and the trophy wall.
 */
@Component({
  selector: 'app-udt-club',
  imports: [RouterLink, TPipe, NeuroPipe, UdtNav, UdtCrestMark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
    @if (view(); as v) {
      @if (!v.team) {
        <p class="card muted">
          {{ 'udt.packs.noTeam' | t }} <a routerLink="/udt/team">{{ 'udt.nav.team' | t }}</a>
        </p>
      } @else {
        <section class="card club" aria-labelledby="club-title">
          <div class="chead">
            <div class="who">
              @if (v.crest; as c) {
                <udt-crest [crest]="c" [tag]="v.team.tag" [size]="52" />
              }
              <div>
                <div class="kpi">
                  {{ v.team.name }} · {{ 'udt.season' | t: { n: v.season ?? 0 } }}
                </div>
                <h1 id="club-title" class="disp">{{ 'udt.club.title' | t }}</h1>
              </div>
            </div>
            <p class="muted intro">
              {{ 'udt.club.intro' | t: { i: indexText() } }}
            </p>
            <div class="spent">
              <div class="v neuro mono">{{ v.clubSpent ?? 0 | neuro }}</div>
              <div class="muted small">{{ 'udt.club.spent' | t }}</div>
            </div>
          </div>
          <div class="cgrid">
            @for (x of tiles(); track x.b.kind) {
              <div class="bld" [class.built]="x.built">
                <div class="bhead">
                  <h2>{{ 'udt.club.k.' + x.b.kind | t }}</h2>
                  @if (x.multi) {
                    <span
                      class="lvl"
                      role="img"
                      [attr.aria-label]="'udt.club.level' | t: { n: x.b.level, max: x.b.max }"
                    >
                      @for (i of x.pips; track i) {
                        <i [class.on]="i < x.b.level"></i>
                      }
                    </span>
                  }
                </div>
                <b class="now" [class.on]="x.built">{{ x.now }}</b>
                <span class="muted small note">{{ x.note }}</span>
                <div class="acts">
                  <button
                    type="button"
                    [class.primary]="!x.top"
                    [class.topped]="x.top"
                    [disabled]="busy() || x.top || (x.b.price ?? 0) > (v.wallet?.spendable ?? 0)"
                    [title]="
                      !x.top && (x.b.price ?? 0) > (v.wallet?.spendable ?? 0)
                        ? ('udt.club.tooDear' | t)
                        : ''
                    "
                    (click)="build(x)"
                  >
                    @if (x.top) {
                      ✓ {{ (x.multi ? 'udt.club.top' : 'udt.club.done') | t }}
                    } @else if (x.multi && x.built) {
                      {{ 'udt.club.levelUp' | t: { n: x.b.level + 1 } }} ·
                      {{ x.b.price ?? 0 | neuro }}
                    } @else {
                      {{ 'udt.club.build' | t }} · {{ x.b.price ?? 0 | neuro }}
                    }
                  </button>
                  @if (x.link; as l) {
                    <a
                      [routerLink]="l.link"
                      [fragment]="l.fragment"
                      (click)="l.fragment && scrollSoon(l.fragment)"
                      >{{ 'udt.club.link.' + x.b.kind | t }}</a
                    >
                  }
                </div>
              </div>
            }
          </div>
        </section>

        @if (trophyRoom()) {
          <div class="troom" id="trophies">
            <section class="card crestbox" aria-labelledby="crest-title">
              <h2 id="crest-title" class="disp">{{ 'udt.crest.title' | t }}</h2>
              <div class="preview">
                <udt-crest [crest]="crest()" [tag]="v.team.tag" [size]="84" />
                <div class="pcol">
                  <b class="tname">{{ v.team.name }}</b>
                  <span class="muted small">{{ 'udt.crest.where' | t }}</span>
                  <span class="inline"
                    ><udt-crest [crest]="crest()" [tag]="v.team.tag" [size]="22" />
                    {{ v.team.name }}</span
                  >
                </div>
              </div>
              <div class="picks" role="group" [attr.aria-label]="'udt.crest.shape' | t">
                @for (s of shapes; track s) {
                  <button
                    type="button"
                    class="shape"
                    [class.on]="crest().shape === s"
                    [attr.aria-pressed]="crest().shape === s"
                    [disabled]="busy()"
                    (click)="pick({ shape: s, color: crest().color })"
                  >
                    {{ 'udt.crest.s.' + s | t }}
                  </button>
                }
              </div>
              <div class="picks" role="group" [attr.aria-label]="'udt.crest.color' | t">
                @for (c of colors; track c; let i = $index) {
                  <button
                    type="button"
                    class="swatch"
                    [style.background]="c"
                    [class.on]="crest().color === c"
                    [attr.aria-pressed]="crest().color === c"
                    [attr.aria-label]="'udt.crest.c.' + colorName(i) | t"
                    [disabled]="busy()"
                    (click)="pick({ shape: crest().shape, color: c })"
                  ></button>
                }
              </div>
              <span class="muted small">{{ 'udt.crest.note' | t }}</span>
            </section>

            <section class="card wall" aria-labelledby="wall-title">
              <h2 id="wall-title" class="disp">{{ 'udt.wall.title' | t }}</h2>
              @if (wall().length) {
                <div class="wgrid">
                  @for (w of wall(); track $index) {
                    <div class="trophy" [class.gold]="w.gold">
                      <span class="wkind" [class.stage]="w.kind === 'stage'">{{
                        'udt.wall.kind.' + w.kind | t
                      }}</span>
                      <b>{{ w.title }}</b>
                      <span class="muted small">{{ w.sub }}</span>
                    </div>
                  }
                </div>
              } @else {
                <p class="muted">{{ 'udt.wall.empty' | t }}</p>
              }
              <span class="muted small">{{ 'udt.wall.note' | t }}</span>
            </section>
          </div>
        }
      }
    }
  `,
  styles: `
    .club {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .chead {
      display: flex;
      align-items: flex-end;
      gap: 12px 18px;
      flex-wrap: wrap;
    }
    .who {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .who h1 {
      margin: 2px 0 0;
    }
    .intro {
      margin: 0;
      flex: 1 1 340px;
    }
    .spent {
      text-align: right;
    }
    .spent .v {
      font-size: var(--fs-lg);
    }
    .cgrid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 14px;
    }
    .bld {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 16px;
      border-radius: var(--radius);
      border: 1px solid var(--line);
      background: var(--bg-2);
    }
    .bld.built {
      border-color: rgba(74, 222, 128, 0.5);
      background: rgba(74, 222, 128, 0.05);
    }
    .bhead {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .bhead h2 {
      margin: 0;
      font-family: var(--font-display);
      font-weight: 700;
      font-size: var(--fs-xl);
      text-transform: uppercase;
    }
    .lvl {
      display: inline-flex;
      gap: 4px;
    }
    .lvl i {
      display: block;
      width: 16px;
      height: 6px;
      border-radius: var(--radius-xs);
      background: var(--line);
    }
    .lvl i.on {
      background: var(--live);
    }
    .now.on {
      color: var(--live);
    }
    .note {
      flex: 1 1 auto;
    }
    .acts {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
    }
    .acts a {
      font-weight: 700;
      font-size: var(--fs-md);
    }
    button.topped:disabled {
      opacity: 1;
      color: var(--live);
      background: var(--border);
      border-color: var(--border);
    }
    .troom {
      display: flex;
      flex-wrap: wrap;
      gap: 18px;
      scroll-margin-top: 80px;
    }
    .crestbox {
      flex: 1 1 380px;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .crestbox h2,
    .wall h2 {
      margin: 0;
    }
    .preview {
      display: flex;
      align-items: center;
      gap: 18px;
    }
    .pcol {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .tname {
      font-family: var(--font-display);
      font-size: var(--fs-xl);
      text-transform: uppercase;
    }
    .inline {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
    }
    .picks {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .shape.on {
      border-color: var(--accent);
      background: rgba(34, 211, 238, 0.14);
    }
    .swatch {
      width: 44px;
      height: 44px;
      min-height: 44px;
      padding: 0;
      border-radius: 50%;
      border: 3px solid var(--panel);
      outline: 1px solid var(--line);
    }
    .swatch.on {
      border-color: var(--text);
    }
    .wall {
      flex: 1 1 480px;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
      border-color: #5b4a1c;
    }
    .wgrid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 10px;
    }
    .trophy {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px 14px;
      border-radius: var(--radius);
      border: 1px solid var(--line);
      background: var(--bg-2);
    }
    .trophy.gold {
      border-color: rgba(245, 199, 94, 0.6);
      background: rgba(245, 199, 94, 0.08);
    }
    .wkind {
      font-size: var(--fs-xs);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
      color: var(--neuro-text);
    }
    .wkind.stage {
      color: var(--udt);
    }
    @media (max-width: 560px) {
      .spent {
        text-align: left;
      }
    }
  `,
})
export class UdtClubPage {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  protected readonly view = signal<UdtView | null>(null);
  private readonly trophies = signal<UdtTrophies | null>(null);
  protected readonly busy = signal(false);
  /** The crest shown while a choice is being saved. */
  private readonly draft = signal<UdtCrest | null>(null);
  protected readonly shapes = CREST_SHAPES;
  protected readonly colors = CREST_COLORS;

  constructor() {
    void this.load();
  }

  async load() {
    try {
      const v = await this.api.udt();
      this.view.set(v);
      this.trophies.set(v.team ? await this.api.udtTrophies() : null);
      // A link to the trophy room (#trophies) lands there once it is drawn.
      if (location.hash === '#trophies')
        setTimeout(() => document.getElementById('trophies')?.scrollIntoView({ block: 'start' }));
    } catch {
      // the toast shows the error
    }
  }

  protected readonly trophyRoom = computed(
    () => ((this.view()?.club ?? []).find((b) => b.kind === 'trophy')?.level ?? 0) > 0,
  );

  protected readonly crest = computed<UdtCrest>(
    () => this.draft() ?? this.view()?.crest ?? { shape: CREST_SHAPES[0], color: CREST_COLORS[0] },
  );

  protected readonly tiles = computed<Tile[]>(() => {
    const v = this.view();
    if (!v) return [];
    const index = v.index;
    const fan = {
      home: this.money(roundNeuro(FANSHOP_PAYS.home * index)),
      cup: this.money(roundNeuro(FANSHOP_PAYS.cupWin * index)),
    };
    return (v.club ?? []).map((b) => {
      const built = b.level > 0;
      const multi = b.max > 1;
      const eff = (n: number) => this.i18n.t(`udt.club.e.${b.kind}.${n}`, fan);
      const now = built
        ? eff(b.level)
        : multi
          ? this.i18n.t('udt.club.first', { eff: eff(1) })
          : eff(1);
      let note = this.i18n.t(`udt.club.n.${b.kind}`);
      if (b.kind === 'fanshop' && built)
        note = this.i18n.t('udt.club.earned', { n: this.money(b.earned) });
      return {
        b,
        now,
        built,
        top: b.price === null,
        multi,
        pips: Array.from({ length: b.max }, (_, i) => i),
        note,
        link: built ? (LINKS[b.kind as ClubUpgrade] ?? null) : null,
      };
    });
  });

  protected readonly wall = computed<WallItem[]>(() => {
    const t = this.trophies();
    if (!t) return [];
    const season = (n: number) => this.i18n.t('udt.season', { n });
    const out: WallItem[] = [];
    for (const l of t.league ?? [])
      out.push({
        kind: 'league',
        title:
          l.kind === 'champion'
            ? this.i18n.t('udt.wall.champion', { tier: this.tierName(l.tier) })
            : l.kind === 'final'
              ? this.i18n.t('udt.wall.final', { n: l.place ?? 0 })
              : this.i18n.t('udt.wall.up', { tier: this.tierName(l.tier) }),
        season: l.season,
        sub: season(l.season),
        gold: l.kind === 'champion',
      });
    for (const c of t.cups)
      out.push({
        kind: 'cup',
        title: this.i18n.t(c.wins === 1 ? 'udt.wall.cup' : 'udt.wall.cups', { n: c.wins }),
        season: c.season,
        sub: season(c.season),
        gold: false,
      });
    for (const s of t.stages)
      out.push({
        kind: 'stage',
        title:
          `${s.name} · ${this.i18n.t(`udt.pres.stage.${s.stage}`)}` +
          (s.stars ? ` ${'★'.repeat(s.stars)}` : ''),
        season: s.season,
        sub: season(s.season),
        gold: false,
      });
    // Newest season first; within a season league, cups, stages (stable sort).
    return out.sort((a, b) => b.season - a.season);
  });

  /** The trophy room on this page: scrolled to after the link changed the fragment. */
  protected scrollSoon(id: string) {
    setTimeout(() =>
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }

  /** The index with two decimals in the page's language ("2,70"). */
  protected readonly indexText = computed(() =>
    (this.view()?.index ?? 0).toLocaleString(this.i18n.locale(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  );

  protected colorName(i: number): string {
    return COLOR_NAMES[i] ?? 'violet';
  }

  private tierName(t: number): string {
    return t === 0 ? 'Pro Series' : this.i18n.t('league.division', { n: t });
  }

  private money(n: number): string {
    return formatNeuro(n, this.i18n.lang());
  }

  protected async build(x: Tile) {
    if (x.b.price === null) return;
    const ok = confirm(
      this.i18n.t('udt.club.confirm', {
        name: this.i18n.t(`udt.club.k.${x.b.kind}`),
        n: x.b.level + 1,
        price: this.money(x.b.price),
      }),
    );
    if (!ok) return;
    await this.act(async () => {
      this.view.set(await this.api.udtClub(x.b.kind));
      if (x.b.kind === 'trophy') this.trophies.set(await this.api.udtTrophies());
    });
  }

  protected async pick(c: UdtCrest) {
    this.draft.set(c);
    await this.act(async () => this.view.set(await this.api.udtCrest(c)));
    this.draft.set(null);
  }

  private async act(fn: () => Promise<void>) {
    this.busy.set(true);
    try {
      await fn();
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }
}
