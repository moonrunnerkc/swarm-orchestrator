import type { Finding } from "./health.ts";

/**
 * The report, as lines. Pure, so what it says is a test rather than something read off a
 * terminal once. Worst first, each finding with the commands that resolve it, because a
 * diagnosis a person has to translate into an action is half an answer.
 */
export function describeInstall(findings: readonly Finding[], fixable: boolean): readonly string[] {
  const lines: string[] = ["", "how swarm is installed", ""];

  for (const finding of findings) {
    lines.push(`  ${mark(finding.severity)}  ${finding.summary}`);
    lines.push(`      ${finding.detail}`);
    for (const command of finding.remedy) {
      lines.push(`      run: ${command}`);
    }
    lines.push("");
  }

  if (fixable) {
    lines.push("  swarm doctor --fix runs those, in that order.");
    lines.push("");
  }
  return lines;
}

function mark(severity: Finding["severity"]): string {
  if (severity === "broken") return "BROKEN ";
  if (severity === "worth-knowing") return "NOTE   ";
  return "OK     ";
}
