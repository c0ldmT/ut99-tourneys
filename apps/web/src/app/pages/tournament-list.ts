import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { Auth } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import type { TournamentSummary } from '../core/types';

@Component({
  selector: 'app-tournament-list',
  imports: [RouterLink, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="spread">
      <h1>{{ 'list.title' | t }}</h1>
      @if (auth.me()?.isAdmin) {
        <a class="btn primary" routerLink="/new">{{ 'list.new' | t }}</a>
      }
    </div>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    @if (items(); as list) {
      @if (!list.length) {
        <p class="muted">{{ 'list.empty' | t }}</p>
      }
      <div class="cards">
        @for (t of list; track t.id) {
          <a class="card item" [routerLink]="['/t', t.id]">
            <div class="spread">
              <h2>{{ t.name }}</h2>
              <span class="badge" [class]="t.phase">{{ 'phase.' + t.phase | t }}</span>
            </div>
            <div class="muted small">
              {{ 'format.' + t.format | t }} · {{ t.size }} {{ 'list.slots' | t }} ·
              {{ 'list.registered' | t: { n: t.registered } }}
            </div>
            @if (t.scheduledAt) {
              <div class="small">{{ i18n.date(t.scheduledAt) }}</div>
            }
            @if (t.champion) {
              <div class="small">🏆 {{ t.champion }}</div>
            }
            @if (t.registeredMe) {
              <div class="small accent">{{ 'list.youPlay' | t }}</div>
            } @else if (t.phase === 'draft' && t.registrationOpen) {
              <div class="small accent">{{ 'list.open' | t }}</div>
            }
          </a>
        }
      </div>
    } @else {
      <p class="muted">{{ 'common.loading' | t }}</p>
    }
  `,
  styles: `
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
      margin-top: 16px;
    }
    .item {
      display: block;
      color: var(--text);
      margin: 0;
    }
    .item:hover {
      border-color: var(--line);
      text-decoration: none;
    }
    .item h2 {
      margin: 0;
    }
    .accent {
      color: var(--accent);
      margin-top: 6px;
    }
  `,
})
export class TournamentListPage {
  protected readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  private readonly api = inject(Api);
  protected readonly items = signal<TournamentSummary[] | null>(null);
  protected readonly error = signal('');

  constructor() {
    this.api
      .tournaments()
      .then((l) => this.items.set(l))
      .catch((e) => this.error.set(errorText(e)));
  }
}
