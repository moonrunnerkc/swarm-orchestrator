// Tracks per-severity counts and formats a summary for display on exit.

import { LEVELS } from "./filter.js";

export function createStats() {
  const counts = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  let total = 0;

  return {
    record(severity) {
      if (severity in counts) counts[severity]++;
      total++;
    },

    summary() {
      return { ...counts, total };
    },

    formatSummary() {
      const lines = LEVELS.map((l) => `  ${l}: ${counts[l]}`);
      lines.push(`  total: ${total}`);
      return `\n--- stats ---\n${lines.join("\n")}`;
    },
  };
}
