#!/usr/bin/env node
/**
 * A scripted stand-in for the agent, accepted by the feedback-study driver for the synthetic
 * cohort and refused for any other. It makes every path the plumbing has to carry happen on
 * demand, and says nothing about any model:
 *
 *   - the prefix of clamp leaves the high branch unexecuted by the visible cases (reach only);
 *   - the prefix of sign leaves one branch unexecuted and one guard whose inversion the visible
 *     cases accept while coverage sees the change (both findings);
 *   - initials is fully exercised; words is wrong; duration is never written;
 *   - told about reach or a mutant, it rewrites the function, narrowing clamp and folding sign
 *     into one expression; given a neutral review, it changes nothing.
 *
 *   node scripted-agent.mjs <workspace> <prompt>
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const [workspace, prompt] = process.argv.slice(2);
const toldAFinding =
  prompt.includes("Changed lines the acceptance check did not exercise:") ||
  prompt.includes("Changes to the code that the acceptance check did not notice:");
const reviewing = prompt.includes("has already been worked on in this workspace");
const write = (path, text) => writeFileSync(join(workspace, path), text);

if (reviewing && !toldAFinding) {
  // A neutral review of work it considers done.
} else if (prompt.includes("clamp(")) {
  write(
    "lib/clamp.js",
    toldAFinding
      ? "export function clamp(value, low) {\n  if (value < low) {\n    return low;\n  }\n  return value;\n}\n"
      : "export function clamp(value, low, high) {\n  if (value < low) {\n    return low;\n  }\n  if (value > high) {\n    return high;\n  }\n  return value;\n}\n",
  );
} else if (prompt.includes("sign(")) {
  write(
    "lib/sign.js",
    toldAFinding
      ? 'export function sign(value) {\n  return value === 0 ? "zero" : value < 0 ? "negative" : "positive";\n}\n'
      : 'export function sign(value) {\n  if (value === 0) {\n    return "zero";\n  }\n  if (value < 0) {\n    return "negative";\n  }\n  return "positive";\n}\n',
  );
} else if (prompt.includes("initials(")) {
  write(
    "lib/initials.js",
    'export function initials(name) {\n  return name\n    .split(/\\s+/)\n    .filter((word) => word.length > 0)\n    .map((word) => word[0].toUpperCase())\n    .join("");\n}\n',
  );
} else if (prompt.includes("reverseWords(")) {
  write(
    "lib/words.js",
    'export function reverseWords(text) {\n  return text.split("").reverse().join("");\n}\n',
  );
}
