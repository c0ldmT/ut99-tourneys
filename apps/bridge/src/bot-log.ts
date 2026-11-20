import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import type { BotThought } from './live-board.js';
import type { Logger } from './log.js';

/** Days of bot logs kept unless bridge.json says otherwise (`botLogDays`, 0 = for good). */
export const BOT_LOG_DAYS = 90;

const LOG_FILE = /^bot-thoughts-(\d{4}-\d{2}-\d{2})\.jsonl(\.gz)?$/;

/**
 * What the bots were up to (mod 0.16.0 `bt` lines with the bot's health, armour and weapon), one
 * JSON line each in `<dir>/bot-thoughts-YYYY-MM-DD.jsonl` (UTC days), for calibrating the skill
 * curve with real games. Writes never block the game. When a new day starts, the days before it
 * are gzipped (`.jsonl.gz`, about a tenth of the size; zlib runs off the event loop) and days
 * older than `days` go (decision 246).
 */
export class BotLog {
  private queue: Promise<void> = Promise.resolve();
  private day = '';
  private failed = false;

  constructor(
    private readonly dir: string,
    private readonly log: Logger,
    private readonly days: number = BOT_LOG_DAYS,
  ) {}

  add(t: BotThought): void {
    const day = new Date(t.at).toISOString().slice(0, 10);
    const line = `${JSON.stringify(t)}\n`;
    this.queue = this.queue.then(async () => {
      try {
        if (day !== this.day) {
          await fs.promises.mkdir(this.dir, { recursive: true });
          this.day = day;
          await this.tidy(day);
        }
        await fs.promises.appendFile(path.join(this.dir, `bot-thoughts-${day}.jsonl`), line);
      } catch (e) {
        if (!this.failed) this.log.warn(`bot log: ${(e as Error).message}`);
        this.failed = true;
      }
    });
  }

  /** Waits for the pending writes (tests). */
  flush(): Promise<void> {
    return this.queue;
  }

  /** Old days go, the days before today are gzipped. */
  private async tidy(today: string): Promise<void> {
    const oldest = this.days
      ? new Date(Date.parse(`${today}T00:00:00Z`) - (this.days - 1) * 86_400_000)
          .toISOString()
          .slice(0, 10)
      : '';
    for (const f of await fs.promises.readdir(this.dir)) {
      const m = LOG_FILE.exec(f);
      if (!m) continue;
      const file = path.join(this.dir, f);
      if (m[1]! < oldest) await fs.promises.rm(file, { force: true });
      else if (!m[2] && m[1]! < today) await this.gzip(file);
    }
  }

  /** `<file>.gz` next to it; the plain file goes once the archive is complete. */
  private async gzip(file: string): Promise<void> {
    const part = `${file}.gz.part`;
    try {
      await pipeline(fs.createReadStream(file), zlib.createGzip(), fs.createWriteStream(part));
      await fs.promises.rename(part, `${file}.gz`);
      await fs.promises.rm(file, { force: true });
    } catch (e) {
      await fs.promises.rm(part, { force: true });
      this.log.warn(`bot log: cannot gzip ${path.basename(file)}: ${(e as Error).message}`);
    }
  }
}
