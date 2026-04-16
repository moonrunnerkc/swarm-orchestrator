// Severity level definitions and log-line filtering.

const LEVELS = ["debug", "info", "warn", "error", "fatal"];
const RANK = Object.fromEntries(LEVELS.map((l, i) => [l, i]));

// Matches [ERROR], [error], ERROR:, error:, or bare severity at line start.
const SEVERITY_RE = new RegExp(
  `\\[?(${LEVELS.join("|")})\\]?[:\\s]`,
  "i"
);

export function parseSeverity(line) {
  const m = line.match(SEVERITY_RE);
  return m ? m[1].toLowerCase() : null;
}

export function meetsThreshold(severity, threshold) {
  const sRank = RANK[severity] ?? -1;
  const tRank = RANK[threshold] ?? 0;
  return sRank >= tRank;
}

export function isValidLevel(level) {
  return LEVELS.includes(level);
}

export { LEVELS };
