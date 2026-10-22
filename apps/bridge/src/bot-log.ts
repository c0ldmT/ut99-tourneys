import fs from 'node:fs';
import path from 'node:path';
import type { BotThought } from './live-board.js';
import type { Logger } from './log.js';

/** Days of bot logs kept. */
export const BOT_LOG_DAYS = 14;

/**
 * What the bots were up to (mod 0.16.0 `bt` lines with the bot's health, armour and weapon), one
 * JSON line each in `<dir>/bot-thoughts-YYYY-MM-DD.jsonl` (UTC days), for calibrating the skill
 * curve with real games. Writes never block the game; logs older than BOT_LOG_DAYS go.
 */
export class BotLog {
  private queue: Promise<void> = Promise.resolve();
  private day = '';
  private failed = false;

  constructor(
    private readonly dir: string,
    private readonly log: Logger,
  ) {}

  add(t: BotThought): void {
    const day = new Date(t.at).toISOString().slice(0, 10);
    const line = `${JSON.stringify(t)}\n`;
    this.queue = this.queue.then(async () => {
      try {
        if (day !== this.day) {
          await fs.promises.mkdir(this.dir, { recursive: true });
          this.day = day;
          await this.prune(day);
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

  private async prune(today: string): Promise<void> {
    const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - (BOT_LOG_DAYS - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    for (const f of await fs.promises.readdir(this.dir)) {
      const m = /^bot-thoughts-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (m && m[1]! < oldest) await fs.promises.rm(path.join(this.dir, f), { force: true });
    }
  }
}
