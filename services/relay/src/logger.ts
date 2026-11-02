export type LogLevel = "error" | "info" | "debug";
export type Logger = (level: LogLevel, event: string, fields?: Record<string, unknown>) => void;

const RANK: Record<LogLevel, number> = { error: 0, info: 1, debug: 2 };

/** One JSON line per event on stderr. Callers never pass secrets or panel text. */
export function createLogger(level: LogLevel): Logger {
  const max = RANK[level];
  return (entryLevel, event, fields = {}) => {
    if (RANK[entryLevel] > max) return;
    process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: entryLevel, event, ...fields })}\n`);
  };
}
