import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { I18n, TPipe } from '../core/i18n';
import type { AgentView } from '../core/types';

@Component({
  selector: 'app-agents',
  imports: [FormsModule, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="spread">
      <h1>{{ 'agents.title' | t }}</h1>
      <button (click)="load()">{{ 'common.refresh' | t }}</button>
    </div>
    <p class="muted">{{ 'agents.intro' | t }}</p>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }

    @if (newToken(); as tk) {
      <div class="card">
        <h2>{{ 'agents.tokenTitle' | t: { id: tk.id } }}</h2>
        <p class="notice">{{ 'agents.tokenOnce' | t }}</p>
        <pre class="mono snippet">{{ snippet(tk.id, tk.token) }}</pre>
        <button (click)="copy(snippet(tk.id, tk.token))">{{ 'common.copy' | t }}</button>
        <button class="link" (click)="newToken.set(null)">{{ 'common.close' | t }}</button>
      </div>
    }

    @for (a of agents(); track a.id) {
      <div class="card">
        <div class="spread">
          <h2>
            <span class="dot" [class.on]="a.online"></span> {{ a.name }}
            <span class="muted small">({{ a.id }})</span>
          </h2>
          <div class="row">
            <button (click)="rotate(a)">{{ 'agents.newToken' | t }}</button>
            <button class="danger" (click)="remove(a)">{{ 'common.delete' | t }}</button>
          </div>
        </div>
        <div class="muted small">
          @if (a.online) {
            {{ 'agents.online' | t }}
          } @else {
            {{ 'agents.offline' | t }}
          }
          @if (a.agentVersion) {
            · v{{ a.agentVersion }} · {{ a.os }}/{{ a.arch }}
          }
          @if (a.lastSeenAt) {
            · {{ 'agents.lastSeen' | t }} {{ i18n.date(a.lastSeenAt) }}
          }
        </div>
        @if (a.status; as s) {
          <p class="small">
            {{ 'agents.server' | t }}: <b>{{ s.state }}</b>
            @if (s.map) {
              · {{ s.map }}
            }
            · {{ 'agents.mod' | t }}: {{ s.modConnected ? '✓' : '–' }} ·
            {{ 'agents.players' | t: { n: s.players.length } }}
            @if (s.tournamentId) {
              · {{ s.tournamentId }}
            }
          </p>
        }
        @for (p of a.profiles; track p.id) {
          <div class="profile">
            <div class="spread">
              <div>
                <b>{{ p.name }}</b>
                <span class="muted small"
                  >({{ p.id }}, {{ p.os }}, {{ 'agents.port' | t }} {{ p.port
                  }}{{ p.manage ? '' : ', ' + ('agents.unmanaged' | t) }})</span
                >
                <div class="small muted">
                  {{ 'agents.address' | t }}: {{ p.publicAddress || ('agents.noAddress' | t) }}
                </div>
              </div>
              <button (click)="rescan(a, p.id)" [disabled]="!a.online || busy()">
                {{ 'agents.rescan' | t }}
              </button>
            </div>
            @if (p.inventory; as inv) {
              <p class="small">
                {{ 'agents.inventory' | t: { maps: inv.maps.length, bots: inv.bots.length } }}
                <span class="muted">({{ i18n.date(inv.scannedAt) }})</span>
              </p>
              @for (w of inv.warnings; track w) {
                <p class="small error">{{ w }}</p>
              }
            } @else {
              <p class="small muted">{{ 'agents.noInventory' | t }}</p>
            }
          </div>
        }
        @if (!a.profiles.length) {
          <p class="small muted">{{ 'agents.noProfiles' | t }}</p>
        }
      </div>
    }

    <form class="card" (ngSubmit)="create()">
      <h2>{{ 'agents.add' | t }}</h2>
      <div class="fields">
        <div class="field">
          <label for="aid">{{ 'agents.id' | t }}</label>
          <input
            id="aid"
            name="id"
            [(ngModel)]="id"
            pattern="[A-Za-z0-9_-]+"
            placeholder="pi-bridge"
          />
        </div>
        <div class="field">
          <label for="aname">{{ 'agents.name' | t }}</label>
          <input id="aname" name="name" [(ngModel)]="name" placeholder="Raspberry Pi" />
        </div>
      </div>
      <button class="primary" type="submit" [disabled]="!id || !name || busy()">
        {{ 'agents.create' | t }}
      </button>
    </form>
  `,
  styles: `
    .profile {
      border-top: 1px solid var(--border);
      padding-top: 10px;
      margin-top: 10px;
    }
    .snippet {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      overflow-x: auto;
    }
  `,
})
export class AgentsPage {
  protected readonly i18n = inject(I18n);
  private readonly api = inject(Api);
  protected readonly agents = signal<AgentView[]>([]);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly newToken = signal<{ id: string; token: string } | null>(null);
  protected id = '';
  protected name = '';

  constructor() {
    void this.load();
  }

  protected async load() {
    try {
      this.agents.set(await this.api.agents());
      this.error.set('');
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  protected snippet(id: string, token: string): string {
    const ws = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/agent`;
    return JSON.stringify({ agentId: id, website: { url: ws, token } }, null, 2);
  }

  protected copy(text: string) {
    void navigator.clipboard?.writeText(text);
  }

  private async act(fn: () => Promise<void>) {
    this.busy.set(true);
    try {
      await fn();
      this.error.set('');
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
      await this.load();
    }
  }

  protected create() {
    return this.act(async () => {
      const r = await this.api.createAgent(this.id.trim(), this.name.trim());
      this.newToken.set({ id: r.agent.id, token: r.token });
      this.id = '';
      this.name = '';
    });
  }

  protected rotate(a: AgentView) {
    if (!confirm(this.i18n.t('agents.confirmRotate', { id: a.id }))) return;
    return this.act(async () => {
      const r = await this.api.rotateAgentToken(a.id);
      this.newToken.set({ id: a.id, token: r.token });
    });
  }

  protected remove(a: AgentView) {
    if (!confirm(this.i18n.t('agents.confirmDelete', { id: a.id }))) return;
    return this.act(() => this.api.deleteAgent(a.id));
  }

  protected rescan(a: AgentView, profileId: string) {
    return this.act(() => this.api.rescan(a.id, profileId));
  }
}
