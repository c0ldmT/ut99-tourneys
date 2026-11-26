import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  NgZone,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { Coin } from '../core/brand';
import { TPipe } from '../core/i18n';
import { NeuroPipe } from '../core/neuro';
import { SKILL_NAMES } from '../core/skill-names';
import { formOf, peekTarget, type PeekTarget } from '../core/peek';
import type { UdtBotPage, UdtSquad } from '../core/types';

const SHOW_MS = 450;
const CACHE_MS = 5 * 60_000;
const ID = 'na-peek';

type Data = { kind: 'bot'; page: UdtBotPage } | { kind: 'team'; squad: UdtSquad };

/**
 * Hover cards for bots and teams (UX wave 4, W4.4, decision 318): resting the mouse on a link
 * to a bot or a team (or reaching it with the keyboard) shows a small card – rarity, skill, team
 * and form of a bot; manager, size and best bots of a team. One instance in the app shell
 * watches the document, so every page that links a name gets it without changes. Touch screens
 * keep the plain link (a tap opens the page). Data comes from the bot and team pages' own
 * endpoints (nothing a page would not show), cached for five minutes.
 */
@Component({
  selector: 'na-peek',
  imports: [TPipe, NeuroPipe, Coin],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown(); as d) {
      <div
        [id]="id"
        class="peek"
        role="tooltip"
        [style.left.px]="pos().x"
        [style.top.px]="pos().y"
        [class.up]="pos().up"
      >
        @if (d.kind === 'bot') {
          @let p = d.page;
          <div class="h">
            @if (p.team; as t) {
              <span class="tag">{{ t.tag }}</span>
            }
            <b>{{ p.bot.name }}</b>
            @if (p.roster; as r) {
              <span class="rar r-{{ r.rarity }}">{{ 'udt.rarity.' + r.rarity | t }}</span>
            }
          </div>
          <div class="row">
            <span>{{ skill(p.bot.skill) }}</span>
            @if (p.roster; as r) {
              <span>{{ 'peek.level' | t: { n: r.level } }}</span>
            }
            @if (p.bot.value) {
              <span class="neuro"><na-coin [size]="13" />{{ p.bot.value | neuro: false }}</span>
            }
          </div>
          <div class="row muted">
            {{ p.team ? p.team.name : ('peek.noTeam' | t) }}
            @if (p.team?.ai) {
              · {{ 'peek.ai' | t }}
            }
          </div>
          @if (form(p).length) {
            <div class="form" [attr.aria-label]="'peek.form' | t">
              <span class="muted">{{ 'peek.form' | t }}</span>
              @for (f of form(p); track $index) {
                <span class="f {{ f }}">{{ 'peek.' + f | t }}</span>
              }
            </div>
          }
          @if (p.roster?.striking) {
            <div class="warn">{{ 'peek.striking' | t }}</div>
          }
        } @else {
          @let s = d.squad;
          <div class="h">
            <span class="tag">{{ s.team.tag }}</span>
            <b>{{ s.team.name }}</b>
          </div>
          <div class="row muted">
            {{ 'peek.manager' | t: { name: s.manager } }}
            @if (s.ai) {
              · {{ 'peek.ai' | t }}
            }
          </div>
          <div class="row">{{ 'peek.bots' | t: { n: s.roster.length } }}</div>
          @if (best(s).length) {
            <ul>
              @for (b of best(s); track b.botId) {
                <li>
                  <span class="dot r-{{ b.rarity }}" aria-hidden="true"></span>{{ b.name }}
                  <span class="muted">{{ skill(b.skill) }}</span>
                </li>
              }
            </ul>
          }
        }
      </div>
    }
  `,
  styles: `
    .peek {
      position: fixed;
      z-index: 60;
      width: 260px;
      padding: 10px 12px;
      display: grid;
      gap: 6px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel-2);
      box-shadow: 0 12px 32px color-mix(in srgb, var(--bg) 80%, transparent);
      font-size: var(--fs-sm);
      pointer-events: none;
    }
    .peek.up {
      transform: translateY(-100%);
    }
    .h {
      display: flex;
      align-items: baseline;
      gap: 6px;
      min-width: 0;
    }
    .h b {
      font-family: var(--font-display);
      font-size: var(--fs-lg);
      font-style: italic;
      text-transform: uppercase;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tag {
      color: var(--hot-text);
      font-weight: 700;
    }
    .rar {
      margin-left: auto;
      font-size: var(--fs-2xs);
      font-weight: 700;
      text-transform: uppercase;
      color: var(--rc, var(--text-2));
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
    }
    .neuro {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .form {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .form .muted {
      margin-right: 4px;
    }
    .f {
      width: 20px;
      height: 20px;
      display: inline-grid;
      place-items: center;
      border-radius: var(--radius-xs);
      font-size: var(--fs-2xs);
      font-weight: 700;
    }
    .f.w {
      color: var(--live);
      background: color-mix(in srgb, var(--live) 15%, transparent);
    }
    .f.l {
      color: var(--danger);
      background: color-mix(in srgb, var(--danger) 15%, transparent);
    }
    .warn {
      color: var(--danger);
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 3px;
    }
    li {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    li .muted {
      margin-left: auto;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--rc, var(--text-2));
    }
  `,
})
export class PeekCard {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly zone = inject(NgZone);
  protected readonly id = ID;

  private readonly cache = new Map<string, { at: number; data: Promise<Data | null> }>();
  private readonly data = signal<Data | null>(null);
  protected readonly pos = signal({ x: 0, y: 0, up: false });
  private link: HTMLAnchorElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  protected readonly shown = computed(() => this.data());

  constructor() {
    const over = (e: Event) => this.enter(e);
    const out = (e: Event) => this.leave(e);
    const hide = () => this.hide();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.hide();
    };
    this.zone.runOutsideAngular(() => {
      document.addEventListener('pointerover', over);
      document.addEventListener('pointerout', out);
      document.addEventListener('focusin', over);
      document.addEventListener('focusout', out);
      document.addEventListener('keydown', key);
      window.addEventListener('scroll', hide, { passive: true, capture: true });
    });
    const nav = inject(Router).events.subscribe((e) => {
      if (e instanceof NavigationStart) this.hide();
    });
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', over);
      document.removeEventListener('focusout', out);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', hide, { capture: true });
      nav.unsubscribe();
    });
  }

  protected skill(n: number): string {
    return SKILL_NAMES[Math.max(0, Math.min(7, Math.round(n)))] ?? '';
  }

  protected form(p: UdtBotPage): ('w' | 'l')[] {
    return formOf(p.recent ?? []);
  }

  protected best(s: UdtSquad) {
    return [...s.roster].sort((a, b) => b.skill - a.skill).slice(0, 3);
  }

  private enter(e: Event): void {
    if (e instanceof PointerEvent && e.pointerType !== 'mouse') return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || a === this.link || !this.auth.config().udt) return;
    if (e.type === 'focusin' && !a.matches(':focus-visible')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    const target = peekTarget(url.pathname);
    if (!target || url.pathname === location.pathname) return;
    this.hide();
    this.link = a;
    this.timer = setTimeout(() => void this.open(a, target), SHOW_MS);
  }

  private leave(e: Event): void {
    if (!this.link) return;
    const next = (e as PointerEvent | FocusEvent).relatedTarget as Node | null;
    if (next && this.link.contains(next)) return;
    this.hide();
  }

  private async open(a: HTMLAnchorElement, t: PeekTarget): Promise<void> {
    const d = await this.load(t);
    if (!d || this.link !== a || !a.isConnected) return;
    const r = a.getBoundingClientRect();
    const w = 260;
    const x = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const up = r.bottom + 220 > window.innerHeight && r.top > 240;
    this.zone.run(() => {
      this.pos.set({ x, y: up ? r.top - 8 : r.bottom + 8, up });
      this.data.set(d);
    });
    a.setAttribute('aria-describedby', ID);
  }

  private load(t: PeekTarget): Promise<Data | null> {
    const key = `${t.kind}:${t.id}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
    const data: Promise<Data | null> = (
      t.kind === 'bot'
        ? this.api.udtBotPeek(t.id).then((page) => ({ kind: 'bot', page }) as Data)
        : this.api.udtSquadPeek(t.id).then((squad) => ({ kind: 'team', squad }) as Data)
    ).catch(() => null);
    this.cache.set(key, { at: Date.now(), data });
    return data;
  }

  private hide(): void {
    clearTimeout(this.timer);
    this.link?.removeAttribute('aria-describedby');
    this.link = null;
    if (this.data()) this.zone.run(() => this.data.set(null));
  }
}
