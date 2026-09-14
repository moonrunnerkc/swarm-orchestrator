import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function renderAgentInstructions(policy) {
  const numbered = [...policy.matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1]));
  if (numbered.length !== 16 || numbered.some((number, index) => number !== index + 1))
    throw new Error("canonical engineering policy must preserve the 16 ordered invariants");
  return `<!-- Generated from docs/engineering-policy.md by scripts/sync-agent-instructions.mjs. -->\n\n${policy}`;
}

export async function synchronizeInstructions(root, write = false) {
  const expected = renderAgentInstructions(
    await readFile(resolve(root, "docs/engineering-policy.md"), "utf8"),
  );
  const mismatches = [];
  for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
    const path = resolve(root, filename);
    if (write) await writeFile(path, expected);
    else if ((await readFile(path, "utf8")) !== expected) mismatches.push(filename);
  }
  if (mismatches.length)
    throw new Error(
      `instruction drift in ${mismatches.join(", ")}; edit docs/engineering-policy.md and run node scripts/sync-agent-instructions.mjs --write`,
    );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await synchronizeInstructions(
    resolve(import.meta.dirname, ".."),
    process.argv.includes("--write"),
  );
  console.log("both agent instruction files match the canonical engineering policy");
}
