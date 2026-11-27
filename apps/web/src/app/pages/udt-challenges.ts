import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Confirm } from '../components/confirm-dialog';
import { EmptyState } from '../components/empty-state';
import { Guide } from '../components/guide';
import { ReportButton } from '../components/report-button';
import { UdtChallengeDialog } from '../components/udt-challenge-dialog';
import { Api } from '../core/api';
import { Coin } from '../core/brand';
import { I18n, TPipe, WhenPipe } from '../core/i18n';
import { NeuroPipe, formatNeuro } from '../core/neuro';
import type { ChallengeSide, UdtChallenge, UdtChallenges } from '../core/types';
import { UdtNav } from '../core/udt';

/**
 * Dream Team challenges (decision 337, preview "Challenges-Seite" and "Antworten"): answers
 * waiting, the own challenges, open ones of others, the booked games and the last results; the
 * dialog challenges, answers with a counter offer or books a rematch.
 */
@Component({
  selector: 'app-udt-challenges',
  imports: [
    Guide,
    EmptyState,
    ReportButton,
    RouterLink,
    NgTemplateOutlet,
    TPipe,
    WhenPipe,
    NeuroPipe,
    Coin,
    UdtNav,
    UdtChallengeDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav #nav (changed)="load()" />
    @if (data(); as d) {
      <div class="udt-head">
        <div>
          <div class="kpi udt-kick" style="color: var(--chall)">
            {{ 'udt.area.chall' | t }}
          </div>
          <h1 class="disp">{{ 'udt.ch.title' | t }}</h1>
          <p class="muted">
            {{ 'udt.ch.lead' | t: { from: d.rules.from, to: d.rules.to } }}
          </p>
        </div>
        <div class="udt-kpis">
          <div>
            <div class="kpi">{{ 'udt.ch.free' | t }}</div>
            <div class="v">{{ d.spendable | neuro }}</div>
          </div>
        </div>
        <button type="button" class="primary go" (click)="dialog().open()">
          {{ 'udt.ch.challenge' | t }}
        </button>
        <na-guide
          page="challenges"
          [params]="{
            from: d.rules.from,
            to: d.rules.to,
            fee: d.rules.feePct,
            cap: d.rules.stakeCap,
            h: d.rules.expiryHours,
            lock: d.rules.lockMin,
            n: d.rules.pairPerWeek,
            bonus: d.rules.mh.recordBonus,
          }"
        />
      </div>

      <div class="cols">
        <div class="stack">
          <section class="card" id="incoming">
            <h2>
              {{ 'udt.ch.incoming' | t }}
              @if (d.incoming.length) {
                <span class="udt-badge">{{ d.incoming.length }}</span>
              }
            </h2>
            @for (c of d.incoming; track c.id) {
              <ng-container
                [ngTemplateOutlet]="row"
                [ngTemplateOutletContext]="{ $implicit: c, kind: 'in' }"
              />
            } @empty {
              <na-empty [text]="'udt.ch.noIncoming' | t" />
            }
          </section>

          <section class="card">
            <h2>{{ 'udt.ch.outgoing' | t }}</h2>
            @for (c of d.outgoing; track c.id) {
              <ng-container
                [ngTemplateOutlet]="row"
                [ngTemplateOutletContext]="{ $implicit: c, kind: 'out' }"
              />
            } @empty {
              <na-empty [text]="'udt.ch.noOutgoing' | t" />
            }
          </section>

          @if (d.open.length) {
            <section class="card">
              <h2>{{ 'udt.ch.openOnes' | t }}</h2>
              @for (c of d.open; track c.id) {
                <ng-container
                  [ngTemplateOutlet]="row"
                  [ngTemplateOutletContext]="{ $implicit: c, kind: 'open' }"
                />
              }
            </section>
          }
        </div>

        <div class="stack">
          <section class="card">
            <h2>{{ 'udt.ch.upcoming' | t }}</h2>
            @for (c of d.upcoming; track c.id) {
              <ng-container
                [ngTemplateOutlet]="row"
                [ngTemplateOutletContext]="{ $implicit: c, kind: 'up' }"
              />
            } @empty {
              <na-empty [text]="'udt.ch.noUpcoming' | t" />
            }
          </section>
          <section class="card">
            <h2>{{ 'udt.ch.recent' | t }}</h2>
            @for (c of d.recent; track c.id) {
              <ng-container
                [ngTemplateOutlet]="row"
                [ngTemplateOutletContext]="{ $implicit: c, kind: 'done' }"
              />
            } @empty {
              <na-empty [text]="'udt.ch.noRecent' | t" />
            }
          </section>
        </div>
      </div>

      <ng-template #row let-c let-kind="kind">
        <div class="ch" [class.in]="kind === 'in'">
          <div class="what">
            @if (c.mode === 'mh') {
              <span class="show">{{ 'udt.ch.showcase' | t }}</span>
            }
            <span class="vs"
              >{{ kind === 'open' ? side(c.from) : vsText(c) }}
              @if (other(c)?.ai) {
                <span class="ai">{{ 'udt.ch.ai' | t }}</span>
              }
            </span>
            @if (kind === 'done') {
              <span class="badge" [class.win]="c.winner === me()" [class.loss]="lost(c)">{{
                result(c)
              }}</span>
            } @else if (c.status === 'locked') {
              <span class="badge live">{{ 'udt.ch.st.locked' | t }}</span>
            }
          </div>
          <div class="facts">
            <span>{{ formatText(c) }}</span>
            <span>{{ c.scheduledAt | when: 'dayTime' }}</span>
            @if (c.stake) {
              <span class="n"
                ><na-coin [size]="12" /> {{ 'udt.ch.perTeam' | t: { n: neuro(c.stake) } }}</span
              >
            } @else {
              <span class="fr">{{ 'udt.ch.friendly' | t }}</span>
            }
            @if (c.map) {
              <span>{{ c.map }}</span>
            }
            @if (c.round > 1) {
              <span>{{ 'udt.ch.round' | t: { n: c.round } }}</span>
            }
          </div>
          @if (c.message) {
            <p class="msg">
              “{{ c.message }}”
              @if (!c.mine) {
                <na-report kind="challenge" [ref]="c.id" [label]="'mod.kind.challenge' | t" />
              }
            </p>
          }
          <div class="act">
            @switch (kind) {
              @case ('in') {
                <span class="due small grow">{{
                  'udt.ch.until' | t: { when: (c.expiresAt | when: 'relShort') }
                }}</span>
                <button type="button" [disabled]="busy()" (click)="decline(c)">
                  {{ 'udt.ch.decline' | t }}
                </button>
                @if (c.round < data()!.rules.maxRounds) {
                  <button type="button" [disabled]="busy()" (click)="dialog().open({ counter: c })">
                    {{ 'udt.ch.counter' | t }}
                  </button>
                }
                <button type="button" class="primary" [disabled]="busy()" (click)="accept(c)">
                  {{ 'udt.ch.accept' | t }}
                </button>
              }
              @case ('open') {
                <span class="due small grow">{{
                  'udt.ch.until' | t: { when: (c.expiresAt | when: 'relShort') }
                }}</span>
                <button type="button" class="primary" [disabled]="busy()" (click)="accept(c)">
                  {{ 'udt.ch.take' | t }}
                </button>
              }
              @case ('out') {
                <span class="due small grow">{{
                  (c.open ? 'udt.ch.waitOpen' : 'udt.ch.waitAnswer')
                    | t: { when: (c.expiresAt | when: 'relShort') }
                }}</span>
                <button type="button" [disabled]="busy()" (click)="withdraw(c)">
                  {{ 'udt.ch.withdraw' | t }}
                </button>
              }
              @case ('up') {
                <span class="muted small grow">{{
                  'udt.ch.prize' | t: { n: neuro(c.prize) }
                }}</span>
                @if (c.tournamentId) {
                  <a class="btn" [routerLink]="['/t', c.tournamentId]">{{
                    'udt.ch.toMatch' | t
                  }}</a>
                }
              }
              @case ('done') {
                <span class="muted small grow">{{ c.decidedAt | when: 'relShort' }}</span>
                @if (c.tournamentId) {
                  <a class="btn" [routerLink]="['/t', c.tournamentId]">{{
                    'udt.ch.toMatch' | t
                  }}</a>
                }
                @if (c.status === 'played' && c.to) {
                  <button type="button" (click)="dialog().open({ rematch: c })">
                    {{ 'udt.ch.rematch' | t }}
                  </button>
                }
              }
            }
          </div>
        </div>
      </ng-template>

      <udt-challenge-dialog
        [rules]="d.rules"
        [spendable]="d.spendable"
        [tier]="d.tier"
        (sent)="done($event)"
      />
    }
  `,
  styles: `
    .go {
      min-height: 44px;
    }
    .cols {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
      gap: 16px;
      align-items: start;
    }
    .stack {
      display: grid;
      gap: 16px;
    }
    h2 {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .ch {
      display: grid;
      gap: 6px;
      padding: 12px;
      border-radius: var(--radius);
      background: var(--panel-2);
    }
    .ch + .ch {
      margin-top: 8px;
    }
    .ch.in {
      box-shadow: inset 3px 0 0 var(--chall);
    }
    .what,
    .facts,
    .act {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 8px;
      align-items: center;
    }
    .vs {
      font-weight: 700;
    }
    .show {
      padding: 2px 10px;
      border-radius: var(--radius-pill);
      font-weight: 700;
      font-size: var(--fs-xs);
      color: var(--chall-ink);
      background: linear-gradient(90deg, var(--chall), var(--neuro));
    }
    .ai {
      font-size: var(--fs-2xs);
      padding: 1px 5px;
      border-radius: var(--radius-xs);
      background: var(--panel-3);
      color: var(--text-2);
    }
    .facts > span {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 10px;
      border-radius: var(--radius-pill);
      background: var(--panel);
      color: var(--text-2);
      font-size: var(--fs-sm);
      white-space: nowrap;
    }
    .facts > .n {
      color: var(--neuro);
    }
    .facts > .fr {
      color: var(--live);
    }
    .badge.win {
      color: var(--live);
    }
    .badge.loss {
      color: var(--danger);
    }
    .msg {
      margin: 0;
      font-style: italic;
      color: var(--text-2);
    }
    .due {
      color: var(--neuro);
    }
    .grow {
      flex: 1 1 auto;
    }
    @media (max-width: 860px) {
      .cols {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class UdtChallengesPage {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  private readonly confirm = inject(Confirm);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly dialog = viewChild.required(UdtChallengeDialog);
  private readonly nav = viewChild.required<UdtNav>('nav');

  protected readonly data = signal<UdtChallenges | null>(null);
  protected readonly busy = signal(false);
  /** The manager's id (the winner of a challenge). */
  protected readonly me = computed(() => this.data()?.me ?? null);

  constructor() {
    void this.load(true);
  }

  async load(first = false) {
    try {
      const d = await this.api.udtChallenges();
      this.set(d);
      // From a team page: the dialog opens with that team (?to=<userId>).
      const to = this.route.snapshot.queryParamMap.get('to');
      if (first && to) {
        setTimeout(() => this.dialog().open({ to }));
        void this.router.navigate([], { queryParams: {}, replaceUrl: true });
      }
    } catch {
      // the toast shows the error
    }
  }

  private set(d: UdtChallenges) {
    this.data.set(d);
    this.nav().setChallengesIn(d.incoming.length);
  }

  protected done(d: UdtChallenges) {
    this.set(d);
  }

  protected neuro(n: number): string {
    return formatNeuro(n, this.i18n.lang());
  }

  protected side(s: ChallengeSide | null): string {
    return s ? `${s.tag} ${s.name}` : '';
  }

  /** The other team (null: an open challenge without a taker). */
  protected other(c: UdtChallenge): ChallengeSide | null {
    return c.mine ? c.to : c.from;
  }

  protected vsText(c: UdtChallenge): string {
    const o = this.other(c);
    if (o) return this.i18n.t('udt.ch.vs', { team: this.side(o) });
    return this.i18n.t(c.open?.scope === 'tier' ? 'udt.ch.openTierTo' : 'udt.ch.openAllTo');
  }

  protected formatText(c: UdtChallenge): string {
    if (c.mode === 'mh')
      return `Monster Hunt · ${this.i18n.t(`udt.ch.hard.${c.hardness ?? 'normal'}`)}`;
    return `${c.teamSize}v${c.teamSize} · Bo${c.bestOf}`;
  }

  protected lost(c: UdtChallenge): boolean {
    return c.status === 'played' && !!c.winner && c.winner !== this.me();
  }

  protected result(c: UdtChallenge): string {
    if (c.status !== 'played') return this.i18n.t(`udt.ch.st.${c.status}`);
    const key = c.winner === this.me() ? 'udt.ch.won' : 'udt.ch.lost';
    return this.i18n.t(c.reason === 'forfeit' ? key + 'Forfeit' : key);
  }

  protected async accept(c: UdtChallenge) {
    const q = this.i18n.t(c.stake ? 'udt.ch.acceptAsk' : 'udt.ch.acceptAskFree', {
      when: this.i18n.when(c.scheduledAt, 'dayTime'),
      n: this.neuro(c.stake),
    });
    if (!(await this.confirm.ask(q, { ok: this.i18n.t('udt.ch.accept') }))) return;
    await this.act(() => this.api.udtChallengeAccept(c.id));
  }

  protected async decline(c: UdtChallenge) {
    await this.act(() => this.api.udtChallengeDecline(c.id));
  }

  protected async withdraw(c: UdtChallenge) {
    if (!(await this.confirm.ask(this.i18n.t('udt.ch.withdrawAsk'), { danger: true }))) return;
    await this.act(() => this.api.udtChallengeWithdraw(c.id));
  }

  private async act(fn: () => Promise<UdtChallenges>) {
    this.busy.set(true);
    try {
      this.set(await fn());
    } catch {
      void this.load();
    } finally {
      this.busy.set(false);
    }
  }
}
