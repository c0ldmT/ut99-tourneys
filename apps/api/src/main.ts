import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './app.js';
import { consoleLogger } from './common/logger.js';
import { loadConfig } from './config.js';

const config = loadConfig();
if (!config.webDist) {
  // Release bundle: website/dist/main.js -> website/web; monorepo: apps/api/dist -> apps/web/dist.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const found = ['../web', '../../web/dist']
    .map((p) => path.resolve(here, p))
    .find((dir) => fs.existsSync(path.join(dir, 'index.html')));
  if (found) config.webDist = found;
}
const log = consoleLogger(config.logLevel);
if (config.devLogin) log.warn('DEV_LOGIN is enabled: anybody can log in with any name');
if (!config.discord.enabled && !config.devLogin) {
  log.warn(
    'neither Discord (DISCORD_CLIENT_ID/SECRET) nor DEV_LOGIN is configured: nobody can log in',
  );
}
const api = await createApi(config, { logger: log });
log.info(`listening on ${config.host}:${config.port} (public URL ${config.publicUrl})`);

let stopping = false;
const stop = async () => {
  if (stopping) {
    // Second Ctrl+C: do not wait any longer.
    log.warn('forced exit');
    process.exit(1);
  }
  stopping = true;
  log.info('shutting down');
  // Never hang on shutdown (a connection that does not close, a stuck request).
  setTimeout(() => {
    log.warn('shutdown took longer than 5 s, exiting');
    process.exit(1);
  }, 5_000).unref();
  try {
    await api.close();
  } catch (e) {
    log.error(`shutdown: ${(e as Error).message}`);
  }
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
