export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ApiLogger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function consoleLogger(min: LogLevel = 'info'): ApiLogger {
  const out = (level: LogLevel, msg: string) => {
    if (ORDER[level] < ORDER[min]) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [api] ${msg}`;
    if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
  };
  return {
    debug: (m) => out('debug', m),
    info: (m) => out('info', m),
    warn: (m) => out('warn', m),
    error: (m) => out('error', m),
  };
}

export const LOGGER = Symbol('LOGGER');
