import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { renderAgentInstructions, synchronizeInstructions } from "./sync-agent-instructions.mjs";

const directories = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
it("detects drift outside the numbered invariants and restores both generated files", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-policy-"));
  directories.push(root);
  await mkdir(join(root, "docs"));
  const policy =
    "# Engineering policy\n\n## Invariants\n\n" +
    Array.from({ length: 16 }, (_, index) => `${index + 1}. Rule ${index + 1}.\n`).join("") +
    "\n## Code Style\nPreserve evidence.\n";
  await writeFile(join(root, "docs/engineering-policy.md"), policy);
  await synchronizeInstructions(root, true);
  await synchronizeInstructions(root);
  await writeFile(
    join(root, "AGENTS.md"),
    (await readFile(join(root, "AGENTS.md"), "utf8")).replace(
      "Preserve evidence.",
      "Changed rule.",
    ),
  );
  await expect(synchronizeInstructions(root)).rejects.toThrow("instruction drift in AGENTS.md");
  await synchronizeInstructions(root, true);
  expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(
    await readFile(join(root, "CLAUDE.md"), "utf8"),
  );
});
it("refuses a missing, reordered or duplicated invariant", () => {
  for (const numbers of [[1, 2], [...Array(16)].map((_, index) => 16 - index), Array(16).fill(1)])
    expect(() =>
      renderAgentInstructions(numbers.map((number) => `${number}. Rule.\n`).join("")),
    ).toThrow("16 ordered invariants");
});
