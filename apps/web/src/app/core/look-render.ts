import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  WebGLRenderer,
  type Material,
  type Texture,
} from 'three';
import type { MeshPreview } from './types';

/**
 * Draws a bot model with its skin for the look editors (decision 176), the way UT does it: the
 * mesh's idle animation (vertex frames, smoothly blended), one texture per skin slot, UT's poly
 * flags. Loaded on demand (three.js is a separate chunk). Drag turns the model; otherwise it
 * turns slowly by itself.
 */

// UT's poly flags (Engine.uc EPolyFlags)
const PF_INVISIBLE = 0x01;
const PF_MASKED = 0x02;
const PF_TRANSLUCENT = 0x04;
const PF_MODULATED = 0x40;
const PF_TWO_SIDED = 0x100;
const PF_UNLIT = 0x400000;

const SPIN = 0.45; // rad/s
const FPS = 30;

function decode(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** UE rotator (65536 = full turn) as UE's FRotationMatrix rows (X, Y, Z axes). */
function rotation([pitch, yaw, roll]: readonly number[]): number[][] {
  const r = (u: number) => (u * Math.PI * 2) / 65536;
  const [sp, cp] = [Math.sin(r(pitch!)), Math.cos(r(pitch!))];
  const [sy, cy] = [Math.sin(r(yaw!)), Math.cos(r(yaw!))];
  const [sr, cr] = [Math.sin(r(roll!)), Math.cos(r(roll!))];
  return [
    [cp * cy, cp * sy, sp],
    [sr * sp * cy - cr * sy, sr * sp * sy + cr * cy, -sr * cp],
    [-(cr * sp * cy + sr * sy), cy * sr - cr * sp * sy, cr * cp],
  ];
}

/** A mesh made ready for drawing: positions per frame (three's axes), wedges, faces. */
class Model {
  readonly frames: Float32Array[] = [];
  readonly wedgeVertex: Uint16Array;
  readonly geometry = new BufferGeometry();
  readonly rate: number;
  readonly height: number;
  readonly center: [number, number, number];
  private readonly pos: Float32Array;
  private readonly nrm: Float32Array;
  private readonly faceVerts: Uint16Array;
  private readonly vn: Float32Array;
  private readonly vp: Float32Array;

  constructor(readonly src: MeshPreview) {
    const n = src.modelVerts;
    const packed = new DataView(decode(src.verts).buffer);
    const R = rotation(src.rotOrigin);
    for (let f = 0; f < src.frames; f++) {
      const out = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const v = packed.getUint32((f * n + i) * 4, true);
        const x = (((v & 0x7ff) ^ 0x400) - 0x400 - src.origin[0]) * src.scale[0];
        const y = ((((v >>> 11) & 0x7ff) ^ 0x400) - 0x400 - src.origin[1]) * src.scale[1];
        const z = ((((v >>> 22) & 0x3ff) ^ 0x200) - 0x200 - src.origin[2]) * src.scale[2];
        const ux = x * R[0]![0]! + y * R[1]![0]! + z * R[2]![0]!;
        const uy = x * R[0]![1]! + y * R[1]![1]! + z * R[2]![1]!;
        const uz = x * R[0]![2]! + y * R[1]![2]! + z * R[2]![2]!;
        // UE (left-handed: X forward, Y right, Z up) → three (right-handed: x right, y up,
        // forward -z); the change of handedness turns the faces' winding around (below)
        out[i * 3] = uy;
        out[i * 3 + 1] = uz;
        out[i * 3 + 2] = -ux;
      }
      this.frames.push(out);
    }
    const w = new DataView(decode(src.wedges).buffer);
    const nw = w.byteLength / 4;
    this.wedgeVertex = new Uint16Array(nw);
    const uv = new Float32Array(nw * 2);
    for (let i = 0; i < nw; i++) {
      this.wedgeVertex[i] = w.getUint16(i * 4, true);
      uv[i * 2] = w.getUint8(i * 4 + 2) / 256;
      uv[i * 2 + 1] = w.getUint8(i * 4 + 3) / 256;
    }
    // Faces grouped by material, the winding turned around for three's handedness.
    const fd = new DataView(decode(src.faces).buffer);
    const nf = fd.byteLength / 8;
    const byMat = src.materials.map(() => [] as number[]);
    const faceVerts: number[] = [];
    for (let i = 0; i < nf; i++) {
      const a = fd.getUint16(i * 8, true);
      const b = fd.getUint16(i * 8 + 2, true);
      const c = fd.getUint16(i * 8 + 4, true);
      const m = fd.getUint16(i * 8 + 6, true);
      const flags = src.materials[m]?.flags ?? 0;
      faceVerts.push(this.wedgeVertex[a]!, this.wedgeVertex[b]!, this.wedgeVertex[c]!);
      if (flags & PF_INVISIBLE) continue;
      byMat[m]?.push(a, c, b);
    }
    this.faceVerts = Uint16Array.from(faceVerts);
    const index: number[] = [];
    byMat.forEach((list, m) => {
      this.geometry.addGroup(index.length, list.length, m);
      index.push(...list);
    });
    this.pos = new Float32Array(nw * 3);
    this.nrm = new Float32Array(nw * 3);
    this.vn = new Float32Array(n * 3);
    this.vp = new Float32Array(n * 3);
    this.geometry.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('normal', new BufferAttribute(this.nrm, 3));
    this.geometry.setAttribute('uv', new BufferAttribute(uv, 2));
    this.geometry.setIndex(index);
    this.rate = src.rate;
    // Framing from the first frame.
    const f0 = this.frames[0]!;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n * 3; i++) {
      min[i % 3] = Math.min(min[i % 3]!, f0[i]!);
      max[i % 3] = Math.max(max[i % 3]!, f0[i]!);
    }
    this.height = Math.max(1, max[1]! - min[1]!, (max[0]! - min[0]!) * 0.8);
    this.center = [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2];
    this.pose(0);
  }

  /** The pose at a time (seconds): two frames blended, smooth normals. */
  pose(t: number): void {
    const n = this.src.modelVerts;
    const count = this.frames.length;
    const at = count > 1 ? (t * this.rate) % count : 0;
    const f0 = Math.floor(at);
    const k = at - f0;
    const A = this.frames[f0]!;
    const B = this.frames[(f0 + 1) % count]!;
    const vp = this.vp;
    for (let i = 0; i < n * 3; i++) vp[i] = A[i]! + (B[i]! - A[i]!) * k;
    const vn = this.vn;
    vn.fill(0);
    const fv = this.faceVerts;
    for (let i = 0; i < fv.length; i += 3) {
      const a = fv[i]! * 3;
      const b = fv[i + 1]! * 3;
      const c = fv[i + 2]! * 3;
      const e1x = vp[b]! - vp[a]!;
      const e1y = vp[b + 1]! - vp[a + 1]!;
      const e1z = vp[b + 2]! - vp[a + 2]!;
      const e2x = vp[c]! - vp[a]!;
      const e2y = vp[c + 1]! - vp[a + 1]!;
      const e2z = vp[c + 2]! - vp[a + 2]!;
      // (c - a) × (b - a): outwards for the turned winding
      const nx = e2y * e1z - e2z * e1y;
      const ny = e2z * e1x - e2x * e1z;
      const nz = e2x * e1y - e2y * e1x;
      for (const v of [a, b, c]) {
        vn[v] = vn[v]! + nx;
        vn[v + 1] = vn[v + 1]! + ny;
        vn[v + 2] = vn[v + 2]! + nz;
      }
    }
    const wv = this.wedgeVertex;
    for (let i = 0; i < wv.length; i++) {
      const v = wv[i]! * 3;
      this.pos[i * 3] = vp[v]!;
      this.pos[i * 3 + 1] = vp[v + 1]!;
      this.pos[i * 3 + 2] = vp[v + 2]!;
      const len = Math.hypot(vn[v]!, vn[v + 1]!, vn[v + 2]!) || 1;
      this.nrm[i * 3] = vn[v]! / len;
      this.nrm[i * 3 + 1] = vn[v + 1]! / len;
      this.nrm[i * 3 + 2] = vn[v + 2]! / len;
    }
    this.geometry.attributes['position']!.needsUpdate = true;
    this.geometry.attributes['normal']!.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
}

export class LookRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(28, 1, 1, 4000);
  private readonly loader = new TextureLoader();
  private readonly textures = new Map<string, Promise<Texture | null>>();
  private model?: Model;
  private mesh?: Mesh;
  private materials: Material[] = [];
  private yaw = 0.35;
  private dragX: number | null = null;
  private lastDrag = -1e9;
  private running = false;
  private disposed = false;
  /** Counts show() calls: only the latest one puts its result on the screen. */
  private gen = 0;
  private visible = true;
  private raf = 0;
  private last = 0;
  private lastDraw = 0;
  private start = performance.now();
  private readonly ro: ResizeObserver;
  private readonly io: IntersectionObserver;

  /** Throws if the browser has no WebGL. */
  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(new AmbientLight(0xffffff, 2.1));
    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.set(1.5, 2, -3); // from the camera's side
    this.scene.add(sun);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.io = new IntersectionObserver((e) => {
      this.visible = e.some((x) => x.isIntersecting);
      this.loop();
    });
    this.io.observe(canvas);
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.up);
    document.addEventListener('visibilitychange', this.loop);
    this.resize();
  }

  /**
   * Shows a model with textures per skin slot (URLs; null = none). Resolves when the textures
   * are there (a missing one draws plain grey).
   */
  async show(mesh: MeshPreview, slotUrls: (string | null)[]): Promise<void> {
    const gen = ++this.gen;
    const model = this.model?.src === mesh ? this.model : new Model(mesh);
    const maps = await Promise.all(
      mesh.materials.map((m) => {
        const url = slotUrls[m.slot] ?? null;
        return url ? this.texture(url) : Promise.resolve(null);
      }),
    );
    if (gen !== this.gen || this.disposed) {
      // a newer look came meanwhile (or the viewer is gone)
      if (model !== this.model) model.geometry.dispose();
      return;
    }
    const before = this.model;
    this.model = model;
    const materials = mesh.materials.map((m, i) => {
      const map = maps[i] ?? null;
      const opts = {
        map,
        color: map ? 0xffffff : 0x6b7280,
        side: m.flags & PF_TWO_SIDED ? DoubleSide : FrontSide,
        alphaTest: m.flags & PF_MASKED ? 0.5 : 0,
        transparent: !!(m.flags & (PF_TRANSLUCENT | PF_MODULATED)),
        depthWrite: !(m.flags & (PF_TRANSLUCENT | PF_MODULATED)),
        ...(m.flags & PF_TRANSLUCENT ? { blending: AdditiveBlending } : {}),
      };
      return m.flags & PF_UNLIT ? new MeshBasicMaterial(opts) : new MeshLambertMaterial(opts);
    });
    for (const old of this.materials) old.dispose();
    this.materials = materials;
    if (!this.mesh) {
      this.mesh = new Mesh(model.geometry, materials);
      this.scene.add(this.mesh);
    } else {
      this.mesh.geometry = model.geometry;
      this.mesh.material = materials;
    }
    if (before && before !== model) before.geometry.dispose();
    this.frame();
    this.resize();
    this.running = true;
    this.loop();
  }

  dispose(): void {
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io.disconnect();
    document.removeEventListener('visibilitychange', this.loop);
    this.canvas.removeEventListener('pointerdown', this.down);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('pointercancel', this.up);
    this.model?.geometry.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures.values()) void t.then((x) => x?.dispose());
    this.renderer.dispose();
    // Browsers keep only a few WebGL contexts: give this one back now.
    this.renderer.forceContextLoss();
  }

  private texture(url: string): Promise<Texture | null> {
    let p = this.textures.get(url);
    if (!p) {
      p = this.loader.loadAsync(url).then(
        (t) => {
          t.flipY = false;
          t.colorSpace = SRGBColorSpace;
          t.magFilter = LinearFilter;
          t.minFilter = LinearMipmapLinearFilter;
          t.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
          return t;
        },
        () => null,
      );
      this.textures.set(url, p);
    }
    return p;
  }

  /** The camera looks at the model's front, the whole figure in view. */
  private frame(): void {
    const m = this.model;
    if (!m) return;
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (m.height * 0.56) / Math.tan(fov / 2);
    // UT's models face +X, which is -z here: the camera stands in front of them.
    this.camera.position.set(m.center[0], m.center[1] + m.height * 0.04, m.center[2] - dist);
    this.camera.lookAt(m.center[0], m.center[1], m.center[2]);
    this.camera.near = dist / 20;
    this.camera.far = dist * 4;
    this.camera.updateProjectionMatrix();
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.draw(performance.now());
  }

  private readonly loop = () => {
    cancelAnimationFrame(this.raf);
    if (this.running && this.visible && !document.hidden) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  };

  private readonly tick = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.1, Math.max(0, now - this.last) / 1000);
    this.last = now;
    // Turns by itself, except while and shortly after the viewer turned it.
    if (this.dragX === null && now - this.lastDrag > 2500) this.yaw += dt * SPIN;
    if (now - this.lastDraw >= 1000 / FPS - 2) this.draw(now);
    this.raf = requestAnimationFrame(this.tick);
  };

  private draw(now: number): void {
    if (!this.model || !this.mesh) return;
    this.lastDraw = now;
    this.model.pose(Math.max(0, now - this.start) / 1000);
    this.mesh.rotation.y = this.yaw;
    // turn around the model's centre
    const c = this.model.center;
    this.mesh.position.set(
      c[0] - (c[0] * Math.cos(this.yaw) + c[2] * Math.sin(this.yaw)),
      0,
      c[2] - (-c[0] * Math.sin(this.yaw) + c[2] * Math.cos(this.yaw)),
    );
    this.renderer.render(this.scene, this.camera);
  }

  private readonly down = (e: PointerEvent) => {
    this.dragX = e.clientX;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private readonly move = (e: PointerEvent) => {
    if (this.dragX === null) return;
    this.yaw += ((e.clientX - this.dragX) / Math.max(120, this.canvas.clientWidth)) * Math.PI;
    this.dragX = e.clientX;
    this.lastDrag = performance.now();
    if (!this.running || !this.visible) this.draw(performance.now());
  };

  private readonly up = (e: PointerEvent) => {
    if (this.dragX === null) return;
    this.dragX = null;
    this.lastDrag = performance.now();
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  };
}
