import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claimsAtBase } from "./authored-claims.ts";

/** tracemantle's base, cut down: history_io.py defines load_ledger and imports Ledger. */
async function base(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "claims-"));
  await mkdir(join(repo, "src", "tracemantle", "core"), { recursive: true });
  await writeFile(join(repo, "src", "tracemantle", "__init__.py"), "");
  await writeFile(
    join(repo, "src", "tracemantle", "core", "history.py"),
    "class Ledger:\n    pass\n",
  );
  await writeFile(
    join(repo, "src", "tracemantle", "core", "history_io.py"),
    "from tracemantle.core.history import Ledger\n\n\ndef load_ledger(path):\n    return Ledger()\n",
  );
  // skillcheck keeps a file of the same name, as tracemantle's repository does.
  await mkdir(join(repo, "src", "skillcheck", "core"), { recursive: true });
  await writeFile(
    join(repo, "src", "skillcheck", "core", "history_io.py"),
    "def Ledger():\n    pass\n",
  );
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.email=t@e", "-c", "user.name=t", "commit", "-qm", "base");
  return repo;
}

const moved = "src/tracemantle/history/history_io.py";

describe("an authored move claim", () => {
  it("is dropped where the file it moves from only imports the name", async () => {
    const read = await claimsAtBase(await base(), [
      { path: moved, symbol: "load_ledger" },
      { path: moved, symbol: "Ledger" },
    ]);
    expect(read.kept.map((one) => one.symbol)).toEqual(["load_ledger"]);
    expect(read.reasons).toEqual([]);
  });

  it("names why, where no claim is left", async () => {
    const read = await claimsAtBase(await base(), [{ path: moved, symbol: "Ledger" }]);
    expect(read.kept).toEqual([]);
    expect(read.reasons).toContain(
      `${moved} cannot come to define Ledger by a move: src/tracemantle/core/history_io.py, the file of that name, does not define it at the base (a name it imports stays defined where it is)`,
    );
  });

  it("is refused where it says an old path the repository keeps elsewhere still provides a name", async () => {
    const read = await claimsAtBase(await base(), [
      { path: moved, symbol: "load_ledger" },
      { path: "core/history.py", symbol: "Ledger", provides: true },
      { path: "old/history.py", symbol: "Ledger", provides: true },
    ]);
    expect(read.reasons).toEqual([
      "core/history.py is not a path from the repository's root; the repository has src/tracemantle/core/history.py",
      "old/history.py is not a path from the repository's root; the repository has src/tracemantle/core/history.py",
    ]);
  });

  it("is refused where its path is the tail of a path the repository has", async () => {
    const read = await claimsAtBase(await base(), [
      { path: moved, symbol: "load_ledger" },
      { path: "core/history_io.py", symbol: "load_ledger", provides: true },
    ]);
    expect(read.reasons).toEqual([
      "core/history_io.py is not a path from the repository's root; the repository has src/skillcheck/core/history_io.py and src/tracemantle/core/history_io.py",
    ]);
  });

  it("is dropped where it says an old source file is gone that the wording keeps as a shim", async () => {
    const task =
      "Move core/history_io.py into a new history/ package, leaving re-export shims at the old paths.";
    const read = await claimsAtBase(
      await base(),
      [
        { path: moved, symbol: "load_ledger" },
        { path: "src/tracemantle/core/history_io.py", absent: true },
      ],
      task,
    );
    expect(read.kept.map((one) => one.path)).toEqual([moved]);
  });
});
