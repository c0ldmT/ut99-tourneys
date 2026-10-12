import { createApi } from './app.js';
import { consoleLogger } from './common/logger.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const log = consoleLogger(config.logLevel);
if (config.devLogin) log.warn('DEV_LOGIN is enabled: anybody can log in with any name');
if (!config.discord.enabled && !config.devLogin) {
  log.warn(
    'neither Discord (DISCORD_CLIENT_ID/SECRET) nor DEV_LOGIN is configured: nobody can log in',
  );
}
const api = await createApi(config, { logger: log });
log.info(`listening on ${config.host}:${config.port} (public URL ${config.publicUrl})`);

const stop = async () => {
  log.info('shutting down');
  await api.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
