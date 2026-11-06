import { createInterface } from "node:readline/promises";
import type { CheckReviewer } from "./agent/check-gate.ts";

/**
 * Shows each authored check with the requirement it witnesses and asks: approve it, edit it in
 * place and have it run at the base again, or reject it.
 */
export function terminalReviewer(): CheckReviewer {
  return async (shown) => {
    const terminal = createInterface({ input: process.stdin, output: process.stderr });
    try {
      process.stderr.write(
        `\nThe check author wrote this check for ${shown.requirement}, run as ${shown.path}:\n\n${shown.content}\n`,
      );
      if (shown.problem !== null)
        process.stderr.write(`Your last edit was refused: ${shown.problem}\n`);
      while (true) {
        const answer = await terminal.question("[a]pprove, [e]dit, or [r]eject it? ");
        if (/^a/i.test(answer)) return "approve";
        if (/^r/i.test(answer)) return "reject";
        if (/^e/i.test(answer)) {
          await terminal.question(`Edit ${shown.file}, then press Enter: `);
          return "edit";
        }
      }
    } finally {
      terminal.close();
    }
  };
}
