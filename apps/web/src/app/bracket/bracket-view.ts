import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { BracketState, Entrant, LiveInfo, MatchState } from '../core/types';
import { I18n } from '../core/i18n';
import { BOX_H, BOX_W, layoutBracket, matchScore } from './layout';

type GameRec = { winnerId: string; scores: Record<string, number> };

@Component({
  selector: 'app-bracket',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (layout(); as l) {
      <div class="scroll">
        <svg
          [attr.viewBox]="'0 0 ' + l.width + ' ' + l.height"
          [style.width]="'clamp(' + l.width * 0.72 + 'px, 100%, ' + l.width + 'px)'"
          role="img"
        >
          @for (s of l.sections; track s.side) {
            <text class="section" [attr.x]="s.side === 'GF' ? gfX() : 0" [attr.y]="s.y + 18">
              {{ s.title }}
            </text>
          }
          @for (c of l.connectors; track c.from + c.to) {
            <path class="line" [class.done]="isDone(c.from)" [attr.d]="c.d" />
          }
          @for (b of l.boxes; track b.match.id) {
            @let m = b.match;
            @let sc = score(m);
            <g
              [attr.transform]="'translate(' + b.x + ',' + b.y + ')'"
              class="match"
              [class.live]="m.id === currentMatchId()"
              [class.void]="m.status === 'void'"
              [class.done]="m.status === 'completed'"
            >
              <title>{{ m.id }} · Bo{{ m.bestOf }}</title>
              <rect class="box" [attr.width]="boxW" [attr.height]="boxH" rx="6" />
              <text class="mid" x="6" y="-4">
                {{ m.id }}
                @if (m.bestOf > 1) {
                  · Bo{{ m.bestOf }}
                }
              </text>
              @for (slot of [0, 1]; track slot) {
                @let id = m.entrants[slot];
                <g
                  [attr.transform]="'translate(0,' + (slot * boxH) / 2 + ')'"
                  [class.winner]="!!id && m.winnerId === id"
                  [class.loser]="!!id && m.loserId === id"
                  [class.me]="!!id && id === myEntrantId()"
                >
                  <rect class="row" [attr.width]="boxW" [attr.height]="boxH / 2" rx="6" />
                  <text class="name" x="10" [attr.y]="boxH / 4 + 5">{{ name(id) }}</text>
                  @if (isBot(id)) {
                    <text class="bot" [attr.x]="boxW - 64" [attr.y]="boxH / 4 + 4">BOT</text>
                  }
                  <text
                    class="score"
                    [attr.x]="boxW - 10"
                    [attr.y]="boxH / 4 + 5"
                    text-anchor="end"
                  >
                    {{ sc[slot] }}
                  </text>
                </g>
              }
              <line class="sep" x1="0" [attr.x2]="boxW" [attr.y1]="boxH / 2" [attr.y2]="boxH / 2" />
            </g>
          }
        </svg>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .scroll {
      overflow-x: auto;
      padding: 8px 2px 4px;
    }
    svg {
      display: block;
      height: auto;
      font-family: var(--font);
    }
    .section {
      fill: var(--muted);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .line {
      fill: none;
      stroke: var(--line);
      stroke-width: 1.5;
    }
    .line.done {
      stroke: var(--accent-dim);
    }
    .box {
      fill: var(--panel);
      stroke: var(--border);
    }
    .row {
      fill: transparent;
    }
    .sep {
      stroke: var(--border);
    }
    .mid {
      fill: var(--muted);
      font-size: 10px;
    }
    .name {
      fill: var(--text);
      font-size: 13px;
    }
    .score {
      fill: var(--text);
      font-size: 13px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .bot {
      fill: var(--muted);
      font-size: 9px;
      letter-spacing: 0.08em;
    }
    .winner .name,
    .winner .score {
      fill: var(--accent);
      font-weight: 700;
    }
    .loser .name,
    .loser .score {
      fill: var(--muted);
    }
    .me .row {
      fill: var(--me-bg);
    }
    .match.live .box {
      stroke: var(--live);
      stroke-width: 2;
    }
    .match.void {
      opacity: 0.35;
    }
  `,
})
export class BracketView {
  readonly bracket = input.required<BracketState>();
  readonly entrants = input.required<Record<string, Entrant>>();
  readonly games = input<Record<string, GameRec[]>>({});
  readonly currentMatchId = input<string | undefined>(undefined);
  readonly live = input<LiveInfo | null>(null);
  readonly myEntrantId = input<string | null>(null);

  private readonly i18n = inject(I18n);
  protected readonly boxW = BOX_W;
  protected readonly boxH = BOX_H;

  protected readonly layout = computed(() =>
    layoutBracket(this.bracket(), {
      W: this.i18n.t('bracket.winners'),
      L: this.i18n.t('bracket.losers'),
      GF: this.i18n.t('bracket.grandFinal'),
      SE: this.i18n.t('bracket.bracket'),
    }),
  );

  protected readonly gfX = computed(() => {
    const gf = this.layout().boxes.find((b) => b.match.side === 'GF');
    return gf ? gf.x : 0;
  });

  protected name(id: string | null): string {
    if (!id) return this.i18n.t('bracket.tbd');
    const n = this.entrants()[id]?.displayName ?? id;
    return n.length > 16 ? `${n.slice(0, 15)}…` : n;
  }

  protected isBot(id: string | null): boolean {
    return !!id && this.entrants()[id]?.kind === 'bot';
  }

  protected isDone(matchId: string): boolean {
    return this.bracket().byId[matchId]?.status === 'completed';
  }

  protected score(m: MatchState): [string, string] {
    return matchScore(m, this.games()[m.id] ?? [], this.live());
  }
}
