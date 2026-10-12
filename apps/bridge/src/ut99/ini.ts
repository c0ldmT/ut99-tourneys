import type { IniChange } from '@tourney/adapter-ut99';

/**
 * Minimal reader/writer for Unreal ini files. Keeps the original line order, comments and
 * duplicate keys (UT uses repeated keys like `ServerPackages=` and `Key[3]=` for arrays).
 * Section and key names compare case-insensitively, like the engine does.
 */

interface Line {
  raw: string;
  section?: string;
  key?: string;
  value?: string;
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export class IniFile {
  private lines: Line[] = [];

  static parse(text: string): IniFile {
    const ini = new IniFile();
    let section: string | undefined;
    for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const t = raw.trim();
      const head = /^\[(.+)\]$/.exec(t);
      if (head) {
        section = head[1];
        ini.lines.push({ raw, section });
        continue;
      }
      const kv = /^([^=;#][^=]*)=(.*)$/.exec(raw);
      if (kv && section !== undefined && !t.startsWith(';')) {
        ini.lines.push({ raw, section, key: (kv[1] as string).trim(), value: kv[2] as string });
      } else {
        ini.lines.push({ raw, ...(section !== undefined ? { section } : {}) });
      }
    }
    // A trailing newline produces one empty line; drop it so serialize() round-trips.
    if (ini.lines.length && ini.lines[ini.lines.length - 1]?.raw === '') ini.lines.pop();
    return ini;
  }

  /** All values of a key (repeated keys return several). */
  getAll(section: string, key: string): string[] {
    return this.lines
      .filter((l) => l.key !== undefined && eq(l.section ?? '', section) && eq(l.key, key))
      .map((l) => l.value as string);
  }

  get(section: string, key: string): string | undefined {
    return this.getAll(section, key)[0];
  }

  /** Key/value pairs of a section in file order. */
  entries(section: string): [string, string][] {
    return this.lines
      .filter((l) => l.key !== undefined && eq(l.section ?? '', section))
      .map((l) => [l.key as string, l.value as string]);
  }

  hasSection(section: string): boolean {
    return this.lines.some(
      (l) =>
        l.key === undefined &&
        l.section !== undefined &&
        eq(l.section, section) &&
        l.raw.trim().startsWith('['),
    );
  }

  /** Sets a key to exactly one value (replaces all existing occurrences). */
  set(section: string, key: string, value: string): void {
    const idx = this.lines.findIndex(
      (l) => l.key !== undefined && eq(l.section ?? '', section) && eq(l.key, key),
    );
    if (idx >= 0) {
      const line = this.lines[idx] as Line;
      line.value = value;
      line.raw = `${line.key}=${value}`;
      this.lines = this.lines.filter(
        (l, i) =>
          i <= idx || !(l.key !== undefined && eq(l.section ?? '', section) && eq(l.key, key)),
      );
      return;
    }
    this.insert(section, { raw: `${key}=${value}`, section, key, value });
  }

  /** Adds `key=value` unless that exact pair already exists (array-like keys). */
  ensure(section: string, key: string, value: string): void {
    if (this.getAll(section, key).some((v) => eq(v, value))) return;
    this.insert(section, { raw: `${key}=${value}`, section, key, value });
  }

  /** Removes every `key=value` line with exactly this value (case-insensitive). */
  remove(section: string, key: string, value: string): void {
    this.lines = this.lines.filter(
      (l) =>
        !(
          l.key !== undefined &&
          eq(l.section ?? '', section) &&
          eq(l.key, key) &&
          eq((l.value ?? '').trim(), value)
        ),
    );
  }

  apply(changes: readonly IniChange[]): void {
    for (const c of changes) {
      if ('ensure' in c) this.ensure(c.section, c.key, c.ensure);
      else if ('remove' in c) this.remove(c.section, c.key, c.remove);
      else this.set(c.section, c.key, c.value);
    }
  }

  /** Serializes with CRLF line endings (works for UT on Windows and Linux). */
  serialize(eol = '\r\n'): string {
    return this.lines.map((l) => l.raw).join(eol) + eol;
  }

  private insert(section: string, line: Line): void {
    // After the last key of the section, or a new section at the end of the file.
    let last = -1;
    let header = -1;
    this.lines.forEach((l, i) => {
      if (l.section !== undefined && eq(l.section, section)) {
        if (l.key === undefined && l.raw.trim().startsWith('[')) header = i;
        if (l.key !== undefined) last = i;
      }
    });
    if (header < 0) {
      if (this.lines.length && this.lines[this.lines.length - 1]?.raw.trim() !== '') {
        this.lines.push({ raw: '' });
      }
      this.lines.push({ raw: `[${section}]`, section }, line);
      return;
    }
    this.lines.splice(Math.max(last, header) + 1, 0, line);
  }
}
