import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TPipe } from '../core/i18n';

/**
 * The loading animation (one for the whole site, see `Loading`): the logo hexagon traced in
 * cyan and violet around a pulsing N.
 */
@Component({
  selector: 'na-loader',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="box" role="status">
      <svg viewBox="0 0 32 32" width="64" height="64" aria-hidden="true">
        <path class="track" d="M16 2 28 9v14l-12 7-12-7V9z" />
        <path class="trace a" pathLength="100" d="M16 2 28 9v14l-12 7-12-7V9z" />
        <path class="trace b" pathLength="100" d="M16 2 28 9v14l-12 7-12-7V9z" />
        <path class="n" d="M11 22V10l10 12V10" />
      </svg>
      <span class="txt">{{ 'common.loading' | t }}</span>
    </div>
  `,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      z-index: 2;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding-top: min(22vh, 180px);
      pointer-events: none;
      animation: show 0.22s ease-out both;
    }
    .box {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    svg {
      overflow: visible;
    }
    path {
      fill: none;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .track {
      stroke: var(--border);
      stroke-width: 2.2;
    }
    .trace {
      stroke-width: 2.4;
      stroke-dasharray: 26 74;
      animation: trace 1.4s linear infinite;
    }
    .trace.a {
      stroke: var(--accent);
      filter: drop-shadow(0 0 3px var(--accent));
    }
    .trace.b {
      stroke: var(--udt, #b26bff);
      filter: drop-shadow(0 0 3px var(--udt, #b26bff));
      animation-delay: -0.7s;
    }
    .n {
      stroke: var(--hot);
      stroke-width: 2.6;
      animation: pulse 1.4s ease-in-out infinite;
    }
    .txt {
      font-family: var(--font-display);
      text-transform: uppercase;
      letter-spacing: 0.18em;
      font-size: 0.75rem;
      color: var(--muted);
    }
    @keyframes trace {
      from {
        stroke-dashoffset: 100;
      }
      to {
        stroke-dashoffset: 0;
      }
    }
    @keyframes pulse {
      0%,
      100% {
        opacity: 0.45;
        filter: none;
      }
      50% {
        opacity: 1;
        filter: drop-shadow(0 0 4px var(--hot));
      }
    }
    @keyframes show {
      from {
        opacity: 0;
        transform: scale(0.94);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      :host {
        animation: none;
      }
      .trace {
        animation: none;
        stroke-dasharray: none;
      }
      .trace.b {
        display: none;
      }
      .n {
        animation: pulse 2.4s ease-in-out infinite;
      }
    }
  `,
})
export class Loader {}
