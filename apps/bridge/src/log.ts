export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function consoleLogger(min: LogLevel = 'info', scope = 'bridge'): Logger {
  const out = (level: LogLevel, msg: string) => {
    if (ORDER[level] < ORDER[min]) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
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

/** Collects log lines in memory (tests). */
export function memoryLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const push = (level: string) => (m: string) => void lines.push(`${level}: ${m}`);
  return {
    lines,
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
  };
}
