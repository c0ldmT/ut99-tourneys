import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EmptyState } from '../components/empty-state';
import { Api } from '../core/api';
import { I18n, TPipe, WhenPipe } from '../core/i18n';
import { Guide } from '../components/guide';
import type { AdminOverview } from '../core/types';

/** The administration's pages, as in the header menu (decision 285). */
const PAGES = [
  { link: '/moderation', label: 'nav.moderation' },
  { link: '/admin/agents', label: 'nav.agents' },
  { link: '/admin/series', label: 'series.title' },
  { link: '/admin/bots', label: 'nav.bots' },
  { link: '/admin/users', label: 'nav.users' },
  { link: '/admin/settings', label: 'nav.settings' },
] as const;

/**
 * The administration's start page (UX wave 4, W4.5, decision 319): what needs an admin at one
 * glance - servers (online, pool, what they play), the moderation queue, the season, the
 * tournaments, the users and the latest problems - with a link to the page that fixes it.
 * One primary button: "New tournament".
 */
@Component({
  selector: 'app-admin-home',
  imports: [Guide, RouterLink, TPipe, WhenPipe, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <h1>{{ 'adm.title' | t }}</h1>
      <a class="btn primary" routerLink="/new">{{ 'nav.new' | t }}</a>
      <na-guide page="admin" />
    </div>
    <nav class="pages" [attr.aria-label]="'adm.pages' | t">
      @for (p of pages; track p.link) {
        <a [routerLink]="p.link">{{ p.label | t }}</a>
      }
    </nav>

    @if (o(); as o) {
      <div class="grid">
        <section class="card servers">
          <div class="ch">
            <h2>{{ 'nav.agents' | t }}</h2>
            <span class="kpi">{{ 'adm.online' | t: { n: online(), of: o.servers.length } }}</span>
          </div>
          @for (s of o.servers; track s.id) {
            <div class="srv">
              <span class="dot" [class.on]="s.online"></span>
              <b>{{ s.name }}</b>
              @if (s.inPool) {
                <span class="badge seeded">{{ 'adm.pool' | t }}</span>
              }
              <span class="st">
                @if (s.playing; as t) {
                  <a [routerLink]="['/t', t.id]">{{ 'adm.playing' | t: { name: t.name } }}</a>
                } @else if (s.online) {
                  <span class="muted">{{ 'adm.free' | t }}</span>
                } @else {
                  <span class="bad">{{
                    s.lastSeenAt
                      ? ('adm.offlineSince' | t: { when: (s.lastSeenAt | when: 'relShort') })
                      : ('adm.neverSeen' | t)
                  }}</span>
                }
              </span>
            </div>
          } @empty {
            <na-empty [text]="'adm.noServers' | t" link="/admin/agents" action="nav.agents" />
          }
        </section>

        <section class="card mod" [class.due]="o.moderation.open > 0">
          <h2>{{ 'nav.moderation' | t }}</h2>
          <div class="big">{{ o.moderation.open }}</div>
          <p class="muted">{{ 'adm.modOpen' | t: { n: o.moderation.open } }}</p>
          <a routerLink="/moderation">{{ 'adm.toQueue' | t }} →</a>
        </section>

        <section class="card">
          <h2>{{ 'adm.season' | t }}</h2>
          @if (o.season; as s) {
            <div class="big">{{ 'adm.seasonN' | t: { n: s.number } }}</div>
            <p class="muted">
              {{ 'adm.season.' + s.status | t }} · {{ i18n.whenDay(s.startDate, 'dayMonth') }} –
              {{ i18n.whenDay(s.endDate, 'dayMonth') }}
            </p>
          } @else {
            <p class="muted">{{ 'adm.noSeason' | t }}</p>
          }
          <a routerLink="/admin/settings">{{ 'adm.toSeasons' | t }} →</a>
        </section>

        <section class="card">
          <h2>{{ 'adm.tournaments' | t }}</h2>
          <dl class="nums">
            <div>
              <dt>{{ 'adm.live' | t }}</dt>
              <dd [class.live]="o.tournaments.live > 0">{{ o.tournaments.live }}</dd>
            </div>
            <div>
              <dt>{{ 'adm.open' | t }}</dt>
              <dd>{{ o.tournaments.open }}</dd>
            </div>
            <div>
              <dt>{{ 'adm.drafts' | t }}</dt>
              <dd>{{ o.tournaments.drafts }}</dd>
            </div>
          </dl>
          @if (o.tournaments.next; as n) {
            <p class="muted">
              {{ 'adm.next' | t }}
              <a [routerLink]="['/t', n.id]">{{ n.name }}</a> · {{ n.at | when: 'relShort' }}
            </p>
          }
          <a routerLink="/">{{ 'adm.toList' | t }} →</a>
        </section>

        <section class="card">
          <h2>{{ 'nav.users' | t }}</h2>
          <div class="big">{{ o.users.total }}</div>
          <p class="muted">
            {{ 'adm.inactive' | t: { n: o.users.inactive, days: o.users.inactiveDays } }}
          </p>
          <a routerLink="/admin/users">{{ 'adm.toUsers' | t }} →</a>
        </section>

        <section class="card wide">
          <div class="ch">
            <h2>{{ 'adm.problems' | t }}</h2>
            <span class="muted small">{{ 'adm.problemsNote' | t: { days: o.problemDays } }}</span>
          </div>
          @for (p of o.problems; track $index) {
            <div class="pr">
              <span class="when muted">{{ p.at | when: 'relShort' }}</span>
              <span [class]="'badge ' + tone(p.kind)">{{ 'adm.kind.' + p.kind | t }}</span>
              <span class="what">
                @if (p.tournament; as t) {
                  <a [routerLink]="['/t', t.id]">{{ t.name || t.id }}</a>
                } @else if (p.server; as s) {
                  <a routerLink="/admin/agents">{{ s.name }}</a>
                }
                @if (p.text) {
                  <span class="muted"> – {{ p.text }}</span>
                }
              </span>
            </div>
          } @empty {
            <na-empty [text]="'adm.noProblems' | t: { days: o.problemDays }" />
          }
        </section>
      </div>
    }
  `,
  styles: `
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .head h1 {
      flex: 1 1 auto;
      margin: 0;
    }
    .pages {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
      margin: 10px 0 18px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    .pages a {
      font-weight: 600;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 16px;
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
    }
    .card h2 {
      margin: 0;
    }
    .card > a:last-child {
      margin-top: auto;
      font-weight: 600;
    }
    .servers,
    .wide {
      grid-column: 1 / -1;
    }
    .ch {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .srv {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding: 8px 0;
      border-top: 1px solid var(--border);
    }
    .srv .st {
      margin-left: auto;
    }
    .bad {
      color: var(--danger);
    }
    .big {
      font-family: var(--font-display);
      font-size: var(--fs-4xl);
      font-weight: 800;
      font-style: italic;
      line-height: 1;
    }
    .mod.due {
      border-color: color-mix(in srgb, var(--hot) 45%, transparent);
    }
    .mod.due .big {
      color: var(--hot-text);
    }
    .card p {
      margin: 0;
    }
    .nums {
      display: flex;
      gap: 22px;
      margin: 0;
    }
    .nums dt {
      font-size: var(--fs-xs);
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .nums dd {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--fs-3xl);
      font-weight: 800;
      font-style: italic;
    }
    .nums dd.live {
      color: var(--live);
    }
    .pr {
      display: grid;
      grid-template-columns: 130px auto 1fr;
      align-items: baseline;
      gap: 10px;
      padding: 8px 0;
      border-top: 1px solid var(--border);
    }
    .pr .badge {
      justify-self: start;
    }
    .what {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    @media (max-width: 600px) {
      .pr {
        grid-template-columns: auto 1fr;
      }
      .pr .what {
        grid-column: 1 / -1;
      }
    }
  `,
})
export class AdminHomePage {
  private readonly api = inject(Api);
  protected readonly i18n = inject(I18n);
  protected readonly pages = PAGES;
  protected readonly o = signal<AdminOverview | null>(null);
  protected readonly online = computed(() => this.o()?.servers.filter((s) => s.online).length ?? 0);

  constructor() {
    void this.load();
  }

  private async load() {
    try {
      this.o.set(await this.api.adminOverview());
    } catch {
      // the Api shows the error as a toast
    }
  }

  /** Badge colour of a problem (the phase colours of the tournament list). */
  protected tone(kind: AdminOverview['problems'][number]['kind']): string {
    return kind === 'paused' || kind === 'warn' ? 'paused' : 'aborted';
  }
}
