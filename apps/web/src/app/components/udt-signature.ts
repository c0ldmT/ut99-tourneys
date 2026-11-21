import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { signatureEffect, WEAPON_CLASS_OF } from '@tourney/udt';
import { I18n, TPipe } from '../core/i18n';
import type { UdtSignature } from '../core/types';

/** The weapon's name for a class name of the game ("ShockRifle" -> "Shock Rifle"). */
const WEAPON_NAME = new Map(
  Object.entries(WEAPON_CLASS_OF).map(([name, cls]) => [cls.toLowerCase(), name] as const),
);

/** Title and effect of a signature in the page's language (decision 274). */
export function signatureTexts(
  i18n: I18n,
  s: UdtSignature,
): { name: string; title: string; effect: string } {
  const what = s.code === 'weapon' ? weaponName(s.weapon) : s.code === 'home' ? (s.map ?? '') : '';
  const name = i18n.t(`udt.sig.${s.code}`);
  return {
    name,
    title: name + (what ? ` · ${what}` : ''),
    effect: i18n.t(`udt.sig.e.${s.code}`, {
      n: Math.round(signatureEffect(s) * 100),
      w: weaponName(s.weapon),
      m: s.map ?? '',
    }),
  };
}

export function weaponName(cls: string | undefined): string {
  return cls ? (WEAPON_NAME.get(cls.toLowerCase()) ?? cls) : '';
}

/**
 * A library bot's signature (decisions 271-274; design "Markt", "Bot-Details · gekaufter Bot"):
 * as a mark in lists (`mark`) or as a box with its level, effect and what it means.
 */
@Component({
  selector: 'udt-signature',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = signature();
    @if (mark()) {
      <span
        class="udt-mark sig"
        [class.star]="s.level === 2"
        [title]="texts().title + ': ' + texts().effect"
        >{{ s.level === 2 ? '★★' : '★' }} {{ texts().name }}</span
      >
    } @else {
      <section class="sigbox" [class.star]="s.level === 2">
        <span class="icon" aria-hidden="true">★</span>
        <div class="col">
          <span class="kick">{{
            (s.level === 2 ? 'udt.sig.kickStar' : 'udt.sig.kick') | t: { n: s.since }
          }}</span>
          <b class="title">{{ texts().title }}</b>
          <span>{{ texts().effect }}</span>
          <span class="muted small">{{
            (inherited() ? 'udt.sig.inherited' : 'udt.sig.stays') | t
          }}</span>
        </div>
      </section>
    }
  `,
  styles: `
    .sigbox {
      display: flex;
      gap: 14px;
      align-items: flex-start;
      padding: 14px;
      border-radius: var(--radius-sm);
      border: 1px solid rgba(178, 107, 255, 0.55);
      background: rgba(178, 107, 255, 0.05);
    }
    .sigbox.star {
      box-shadow: 0 0 0 3px rgba(178, 107, 255, 0.1);
    }
    .icon {
      width: 40px;
      height: 40px;
      flex: none;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: rgba(178, 107, 255, 0.18);
      color: #d4adff;
      font-size: 1.25rem;
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }
    .kick {
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--udt);
    }
    .title {
      font-family: var(--font-display);
      font-size: 1.3rem;
      text-transform: uppercase;
      overflow-wrap: anywhere;
    }
  `,
})
export class UdtSignatureBox {
  private readonly i18n = inject(I18n);
  readonly signature = input.required<UdtSignature>();
  /** A mark for lists instead of the box. */
  readonly mark = input(false);
  /** An apprentice's signature inherited from its mentor (this season only). */
  readonly inherited = input(false);
  protected readonly texts = computed(() => signatureTexts(this.i18n, this.signature()));
}
