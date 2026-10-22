import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Api } from '../core/api';
import { TPipe } from '../core/i18n';
import type { LookRenderer } from '../core/look-render';
import type { MeshPreview } from '../core/types';

/** Meshes per class and installation stamp (shared by all viewers of the page). */
const meshes = new Map<string, Promise<MeshPreview>>();

const TEAMS = [
  { v: null, c: 'transparent', key: 'look.team.none' },
  { v: 0, c: 'var(--side-a)', key: 'look.team.0' },
  { v: 1, c: 'var(--side-b)', key: 'look.team.1' },
  { v: 2, c: '#3fbf5f', key: 'look.team.2' },
  { v: 3, c: 'var(--neuro)', key: 'look.team.3' },
] as const;

const textureUrl = (name: string, stamp: string) =>
  `/api/looks/texture/${encodeURIComponent(name)}?v=${encodeURIComponent(stamp)}`;

/**
 * The 3D preview of a look (decision 176): the bot's model with its skin, face and (optional)
 * team colour, read from the game server's packages. Turns slowly; drag turns it. Without a
 * preview (unknown model, server never synced, no WebGL) it says so in one line.
 */
@Component({
  selector: 'app-look-viewer',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="look3d" [class.ready]="state() === 'ready'" [class.none]="state() === 'none'">
      <canvas #cv role="img" [attr.aria-label]="'look.preview' | t"></canvas>
      @if (state() === 'none') {
        <p class="look3d-none">{{ 'look.none' | t }}</p>
      }
      @if (portrait(); as p) {
        <img class="look3d-face" [src]="p" alt="" />
      }
      @if (teams() && state() === 'ready') {
        <div class="look3d-teams" role="group" [attr.aria-label]="'look.team' | t">
          @for (t of TEAMS; track t.key) {
            <button
              type="button"
              class="look3d-team"
              [class.on]="team() === t.v"
              [style.--c]="t.c"
              [attr.aria-label]="t.key | t"
              [attr.title]="t.key | t"
              [attr.aria-pressed]="team() === t.v"
              (click)="team.set(t.v)"
            ></button>
          }
        </div>
      }
    </div>
  `,
})
export class LookViewer {
  /** The bot class ('' = UT's default class). */
  readonly cls = input('');
  readonly skin = input('');
  readonly face = input('');
  protected readonly team = signal<number | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'none'>('loading');
  protected readonly portrait = signal<string | null>(null);
  protected readonly teams = signal(false);
  protected readonly TEAMS = TEAMS;
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');
  private readonly api = inject(Api);
  private renderer?: Promise<LookRenderer | null>;
  private seq = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private destroyed = false;
  private rendered = false;

  constructor() {
    effect(() => {
      const look = { cls: this.cls(), skin: this.skin(), face: this.face(), team: this.team() };
      untracked(() => {
        // The selects change one after the other: wait a moment for the last one.
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.load(look), this.rendered ? 120 : 0);
      });
    });
    afterNextRender(() => (this.rendered = true));
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      clearTimeout(this.timer);
      void this.renderer?.then((r) => r?.dispose());
    });
  }

  private async load(look: { cls: string; skin: string; face: string; team: number | null }) {
    const seq = ++this.seq;
    const current = () => seq === this.seq && !this.destroyed;
    try {
      const p = await this.api.lookPreview(look.cls, look.skin, look.face, look.team);
      if (!current()) return;
      const key = `${look.cls.toLowerCase()}|${p.stamp}`;
      let mesh = meshes.get(key);
      if (!mesh) {
        mesh = this.api.lookMesh(look.cls, p.stamp);
        meshes.set(key, mesh);
        mesh.catch(() => meshes.delete(key));
      }
      const [m, r] = await Promise.all([mesh, this.ensureRenderer()]);
      if (!current()) return;
      if (!r) throw new Error('no WebGL');
      await r.show(
        m,
        p.slots.map((s) => (s ? textureUrl(s, p.stamp) : null)),
      );
      if (!current()) return;
      this.teams.set(p.teams);
      this.portrait.set(p.portrait ? textureUrl(p.portrait, p.stamp) : null);
      this.state.set('ready');
    } catch {
      if (!current()) return;
      this.state.set('none');
      this.portrait.set(null);
      this.teams.set(false);
    }
  }

  /** three.js comes as its own chunk, the first time a viewer shows a model. */
  private ensureRenderer(): Promise<LookRenderer | null> {
    this.renderer ??= import('../core/look-render').then(
      (m) => {
        try {
          return this.destroyed ? null : new m.LookRenderer(this.canvas().nativeElement);
        } catch {
          return null; // no WebGL
        }
      },
      () => null,
    );
    return this.renderer;
  }
}
