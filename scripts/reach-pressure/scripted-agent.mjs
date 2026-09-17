#!/usr/bin/env node
/**
 * A scripted stand-in for the agent, accepted by the experiment driver for the synthetic cohort
 * and refused for any other. It makes the three situations the plumbing has to carry happen on
 * demand: a patch whose visible oracle accepts and leaves a line unreached, then narrowed when
 * told so; a patch its oracle fully exercises; and a patch that is wrong.
 *
 *   node scripted-agent.mjs <workspace> <prompt>
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const [workspace, prompt] = process.argv.slice(2);
const toldAboutReach = prompt.includes("never executed these lines");

if (prompt.includes("clamp(")) {
  writeFileSync(
    join(workspace, "lib/clamp.js"),
    toldAboutReach
      ? "export function clamp(value, low) {\n  if (value < low) {\n    return low;\n  }\n  return value;\n}\n"
      : "export function clamp(value, low, high) {\n  if (value < low) {\n    return low;\n  }\n  if (value > high) {\n    return high;\n  }\n  return value;\n}\n",
  );
} else if (prompt.includes("initials(")) {
  writeFileSync(
    join(workspace, "lib/initials.js"),
    'export function initials(name) {\n  return name\n    .split(/\\s+/)\n    .filter((word) => word.length > 0)\n    .map((word) => word[0].toUpperCase())\n    .join("");\n}\n',
  );
} else if (prompt.includes("reverseWords(")) {
  writeFileSync(
    join(workspace, "lib/words.js"),
    'export function reverseWords(text) {\n  return text.split("").reverse().join("");\n}\n',
  );
}
