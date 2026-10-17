import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { Auth } from '../core/auth';
import { assetLabel, combatStyleKey, traitPercent } from '../core/bots';
import { TPipe } from '../core/i18n';
import { BOT_LINE_KINDS, type BotProfile } from '../core/types';

/** Bot profile (everybody logged in): look, play style, personality, rivals with the record. */
@Component({
  selector: 'app-bot-profile',
  imports: [TPipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="top">
      <a routerLink="/stats">← {{ 'stats.title' | t }}</a>
      @if (auth.me()?.isAdmin && b()) {
        <a [routerLink]="['/admin/bots']" [queryParams]="{ edit: b()!.id }">{{
          'bots.editInCenter' | t
        }}</a>
      }
    </div>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    @if (b(); as b) {
      <h1>
        @if (b.color) {
          <span class="swatch" [style.background]="b.color"></span>
        }
        {{ b.gameName }}
        <span class="badge">{{ 'stats.bot' | t }}</span>
        @if (!b.active) {
          <span class="badge">{{ 'bots.retired' | t }}</span>
        }
      </h1>
      <p class="sub muted">
        @if (b.clan; as c) {
          <span
            >{{ 'bots.clan' | t }}: <b>{{ c.tag }} {{ c.name }}</b></span
          >
        }
        <span
          >{{ 'bots.skill' | t }}: <b>{{ b.skill }} – {{ 'skill.' + b.skill | t }}</b></span
        >
        <a [routerLink]="['/stats/p', b.statsKey]">{{ 'bots.statsLink' | t }}</a>
      </p>
      @if (b.bio) {
        <p class="bio">{{ b.bio }}</p>
      }
      @if (b.clan?.description) {
        <p class="muted small">{{ b.clan!.description }}</p>
      }

      <div class="grid two">
        <section class="card">
          <h2>{{ 'bots.sec.look' | t }}</h2>
          <dl>
            <dt>{{ 'bots.class' | t }}</dt>
            <dd>{{ b.labels.botClass || name(b.botClass) || ('bots.default' | t) }}</dd>
            <dt>{{ 'bots.skin' | t }}</dt>
            <dd>{{ name(b.skin) || ('bots.default' | t) }}</dd>
            <dt>{{ 'bots.face' | t }}</dt>
            <dd>{{ b.labels.face || name(b.face) || ('bots.default' | t) }}</dd>
            <dt>{{ 'bots.voice' | t }}</dt>
            <dd>{{ b.labels.voice || name(b.traits.voice) || ('bots.default' | t) }}</dd>
          </dl>
        </section>

        <section class="card">
          <h2>{{ 'bots.sec.style' | t }}</h2>
          <dl>
            <dt>{{ 'bots.combatStyle' | t }}</dt>
            <dd>{{ styleKey(b.traits.combatStyle) | t }}</dd>
            <dt>{{ 'bots.weapon' | t }}</dt>
            <dd>{{ b.labels.weapon || name(b.traits.favoriteWeapon) || ('bots.none' | t) }}</dd>
            <dt>{{ 'bots.jumpy' | t }}</dt>
            <dd>{{ (b.traits.jumpy ? 'bots.yes' : 'bots.no') | t }}</dd>
          </dl>
          @for (t of bars; track t.key) {
            <div class="bar-row">
              <span class="small muted">{{ 'bots.trait.' + t.key | t }}</span>
              <span class="bar"><span [style.width.%]="pct(b.traits[t.key], t.min)"></span></span>
            </div>
          }
        </section>
      </div>

      <section class="card">
        <h2>{{ 'bots.sec.rivals' | t }}</h2>
        @if (b.rivals.length) {
          <table>
            <thead>
              <tr>
                <th>{{ 'bots.opponent' | t }}</th>
                <th></th>
                <th>{{ 'bots.record' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (r of b.rivals; track r.key) {
                <tr>
                  <td>
                    @if (r.kind === 'bot') {
                      <a [routerLink]="['/bots', r.id]">{{ r.name }}</a>
                    } @else {
                      <a [routerLink]="['/stats/p', r.key]">{{ r.name }}</a>
                    }
                  </td>
                  <td>
                    <span class="badge" [class.nemesis]="r.level === 'nemesis'">{{
                      'bots.' + r.level | t
                    }}</span>
                  </td>
                  <td>
                    @if (r.record.games) {
                      {{ r.record.wins }}–{{ r.record.games - r.record.wins }}
                      <span class="muted small"
                        >({{ 'bots.games' | t: { n: r.record.games } }})</span
                      >
                    } @else {
                      <span class="muted">{{ 'bots.noGames' | t }}</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <p class="muted">{{ 'bots.noRivals' | t }}</p>
        }
        @if (b.rivalOf.length) {
          <p class="small">
            {{ 'bots.rivalOf' | t }}
            @for (x of b.rivalOf; track x.id; let last = $last) {
              <a [routerLink]="['/bots', x.id]">{{ x.name }}</a
              >{{ last ? '' : ', ' }}
            }
          </p>
        }
        <p class="muted small">{{ 'bots.recordHint' | t }}</p>
      </section>

      <section class="card">
        <h2>{{ 'bots.sec.personality' | t }}</h2>
        <p>{{ 'bots.talkText' | t: { n: b.personality.talk } }}</p>
        @for (g of lineGroups(); track g.kind) {
          <h3>{{ 'bots.kind.' + g.kind | t }}</h3>
          <ul>
            @for (l of g.lines; track $index) {
              <li>“{{ l }}”</li>
            }
          </ul>
        }
      </section>
    }
  `,
  styles: `
    .top {
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
    h1 {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .swatch {
      width: 14px;
      height: 14px;
      border-radius: 4px;
      display: inline-block;
    }
    .sub {
      display: flex;
      gap: 18px;
      flex-wrap: wrap;
    }
    .bio {
      white-space: pre-line;
      max-width: 820px;
    }
    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 4px 16px;
      margin: 0 0 12px;
    }
    dt {
      color: var(--muted);
    }
    dd {
      margin: 0;
    }
    .bar-row {
      display: grid;
      grid-template-columns: 110px 1fr;
      align-items: center;
      gap: 8px;
      margin: 6px 0;
    }
    .bar {
      height: 8px;
      background: var(--panel-2);
      border-radius: 4px;
      overflow: hidden;
    }
    .bar span {
      display: block;
      height: 100%;
      background: var(--accent);
    }
    .badge.nemesis {
      color: var(--danger);
      border-color: var(--danger);
    }
    h3 {
      font-size: 0.95rem;
      margin: 12px 0 4px;
    }
    ul {
      margin: 0;
      padding-left: 20px;
    }
  `,
})
export class BotProfilePage {
  private readonly api = inject(Api);
  protected readonly auth = inject(Auth);
  readonly id = input.required<string>();
  protected readonly b = signal<BotProfile | null>(null);
  protected readonly error = signal('');
  protected readonly styleKey = combatStyleKey;
  protected readonly bars: {
    key: 'accuracy' | 'alertness' | 'strafing' | 'camping';
    min: number;
  }[] = [
    { key: 'accuracy', min: -1 },
    { key: 'alertness', min: -1 },
    { key: 'strafing', min: -1 },
    { key: 'camping', min: 0 },
  ];

  protected readonly lineGroups = computed(() => {
    const b = this.b();
    if (!b) return [];
    return BOT_LINE_KINDS.map((kind) => ({
      kind,
      lines: b.personality.lines.filter((l) => l.kind === kind).map((l) => l.text),
    })).filter((g) => g.lines.length);
  });

  constructor() {
    effect(() => {
      const id = this.id();
      void this.load(id);
    });
  }

  private async load(id: string) {
    this.error.set('');
    try {
      this.b.set(await this.api.botProfile(id));
    } catch (e) {
      this.b.set(null);
      this.error.set(errorText(e));
    }
  }

  protected name(n: string | null | undefined): string {
    return assetLabel(undefined, n);
  }

  protected pct(v: number | undefined, min: number): number {
    return traitPercent(v, min);
  }
}
