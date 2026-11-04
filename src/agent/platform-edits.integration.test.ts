import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Message, ModelClient } from "./model.ts";
import { systemPrompt } from "./prompt.ts";
import { bash, fixture } from "./test-doubles.ts";

/**
 * The in-place edits two macOS runs of 2026-11-03 tried with `sed -i`, which BSD sed reads as a
 * backup suffix, so every one failed and the file never changed. Each turn is the recorded
 * command and the edit block that says the same thing.
 */
const turns = [
  {
    // dossier, session 20261103T205635-acc4bd, ledger record 28.
    recorded: String.raw`sed -i "s/const EXCLUDED_DIRS = new Set(\['node_modules', '\.git', '\.dossier', 'dist', 'out', 'build', 'coverage'\]);/const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.dossier', 'dist', 'out', 'build', 'coverage', '.venv']);/" src/adversarial/fs-walk.ts`,
    edit: [
      "```edit src/adversarial/fs-walk.ts",
      "<<<<<<< SEARCH",
      "const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.dossier', 'dist', 'out', 'build', 'coverage']);",
      "=======",
      "const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.dossier', 'dist', 'out', 'build', 'coverage', '.venv']);",
      ">>>>>>> REPLACE",
      "```",
    ].join("\n"),
  },
  {
    // tracemantle, session 20261103T175257-900062, ledger record 36, its first sed.
    recorded:
      "sed -i 's|tracemantle.core.history_io|tracemantle.history.history_io|g' src/tracemantle/history/history_store.py",
    edit: [
      "```edit src/tracemantle/history/history_store.py",
      "<<<<<<< SEARCH",
      "from tracemantle.core.history_io import _entry_from_dict",
      "=======",
      "from tracemantle.history.history_io import _entry_from_dict",
      ">>>>>>> REPLACE",
      "```",
    ].join("\n"),
  },
];

/** The two files as the commands met them: dossier at 1baa9c6, tracemantle's after the move. */
const files = {
  "src/adversarial/fs-walk.ts": [
    "import { readdirSync, statSync } from 'fs';",
    "import { join, relative } from 'path';",
    "",
    "const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.dossier', 'dist', 'out', 'build', 'coverage']);",
    "",
  ].join("\n"),
  "src/tracemantle/history/history_store.py": [
    "from tracemantle.core.history import LedgerEntry, LedgerError, _entry_to_dict, load_ledger",
    "from tracemantle.core.history_io import _entry_from_dict",
    "from tracemantle.io_limits import MAX_LEDGER_BYTES, MAX_SCAN_BYTES, read_bounded_bytes",
    "",
  ].join("\n"),
};

/**
 * A model that does what the stable prefix tells it: where the prompt offers an edit block it
 * sends the edit, and where it does not, it edits through the shell as the recorded runs did.
 */
function followingThePrefix(): ModelClient & { seen: Message[][] } {
  const seen: Message[][] = [];
  return {
    model: "scripted-prefix-follower",
    seen,
    async complete(messages) {
      seen.push([...messages]);
      const turn = turns[seen.length - 1];
      const offersEdits = (messages[0]?.content ?? "").includes("```edit src/app.ts");
      const content =
        turn === undefined
          ? bash("git status --short")
          : offersEdits
            ? turn.edit
            : bash(turn.recorded);
      return {
        content,
        inputTokens: 90,
        outputTokens: 10,
        inferenceMs: 1,
        retries: 0,
        truncated: false,
      };
    },
  };
}

describe("the recorded macOS sed -i edits, replayed through a model that follows the prefix", () => {
  it("lands both edits in the delivered patch", async () => {
    const probe = await fixture(
      files,
      "Skip .venv in walkRepo, and import history_io from its new package.",
    );
    const model = followingThePrefix();
    const ran = await probe.run(model, { maxSteps: turns.length });
    const patch = await readFile(ran.report.snapshot.patch, "utf8");
    expect(patch).toContain(
      "+const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.dossier', 'dist', 'out', 'build', 'coverage', '.venv']);",
    );
    expect(patch).toContain("+from tracemantle.history.history_io import _entry_from_dict");
  });

  it("states the platform at the head of the prompt, before the repository's instructions", async () => {
    const probe = await fixture(files);
    const model = followingThePrefix();
    await probe.run(model, { maxSteps: 1 });
    const system = model.seen[0]?.[0]?.content ?? "";
    expect(system).toContain("This machine, probed when the run started.");
    const sed = process.platform === "darwin" ? "- sed: BSD" : "- sed: GNU";
    expect(system).toContain(sed);
    expect(system).toContain("Change a file's text with an edit or write block");
  });

  it("records the block whole in the session's evidence, and digests it into the prompt digest", async () => {
    const probe = await fixture(files, "Skip .venv in walkRepo.");
    const model = followingThePrefix();
    const ran = await probe.run(model, { maxSteps: 1 });
    const [first] = (await readFile(join(ran.sessionDirectory, "ledger.jsonl"), "utf8")).split(
      "\n",
    );
    const digest = JSON.parse(first ?? "{}").payloadDigest.replace("sha256:", "");
    const started = JSON.parse(
      await readFile(join(ran.sessionDirectory, "blobs", `${digest}.json`), "utf8"),
    );
    const { block, sha256, probe: output } = started.environment;
    expect(sha256).toBe(createHash("sha256").update(block).digest("hex"));
    expect(output).toContain("sed.inplace=");
    expect(model.seen[0]?.[0]?.content).toBe(`${systemPrompt}\n\n${block}`);
    expect(started.promptSha256).toBe(
      createHash("sha256")
        .update(`${systemPrompt}\n${block}\n\nSkip .venv in walkRepo.`)
        .digest("hex"),
    );
  });
});
