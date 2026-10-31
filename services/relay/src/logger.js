const RANK = { error: 0, info: 1, debug: 2 };

export function createLogger(level) {
  const max = RANK[level] ?? RANK.info;
  return function log(entryLevel, event, fields = {}) {
    if ((RANK[entryLevel] ?? 1) > max) return;
    const line = {
      ts: new Date().toISOString(),
      level: entryLevel,
      event,
      ...fields,
    };
    process.stderr.write(`${JSON.stringify(line)}\n`);
  };
}
