import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conventionsReport, initCommand } from "./cli-conventions.ts";
import { ProposalError } from "./conventions/learn.ts";
import {
  ConventionProfileError,
  effectiveConventions,
  profilePath,
  readProfile,
} from "./conventions/profile.ts";
import { runConventions } from "./conventions/run-conventions.ts";

/**
 * The conventions profile through its real interface: `swarm init --learn`, `--approve`,
 * `--set`, `--forget`, and `swarm doctor --conventions`, on the invoice example's own sources.
 */
const example = join(import.meta.dirname, "..", "examples", "invoice-api");
let home = "";
let repo = "";
let printed = "";
const verifierInit = async () => 99;
const init = (...args: string[]) => initCommand(["--workspace", repo, ...args], verifierInit);

beforeEach(async () => {
  // Resolved, as git reports a repository: a profile is keyed by that path.
  const root = await realpath(await mkdtemp(join(tmpdir(), "conventions-")));
  home = join(root, "home");
  repo = join(root, "repo");
  await cp(example, repo, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["add", "-A"], { cwd: repo });
  process.env.SWARM_HOME = home;
  printed = "";
  vi.spyOn(process.stdout, "write").mockImplementation((text) => {
    printed += String(text);
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Learns from the example's sources and returns the proposal file it wrote. */
async function learned(...paths: string[]): Promise<string> {
  await init("--learn", ...paths);
  const [name] = await readdir(join(home, "conventions", "proposals"));
  return join(home, "conventions", "proposals", name ?? "");
}

describe("learning conventions from examples", () => {
  it("proposes what the samples agree on, into a file, and puts nothing in effect", async () => {
    const proposal = await readFile(await learned(), "utf8");
    expect(proposal).toMatch(
      /"exports" = "named" {2}# inferred: \d+ of \d+ site\(s\) in \d+ file\(s\)/,
    );
    expect(proposal).toContain('"function-names" = "camelCase"');
    expect(proposal).toContain('"explicit-any" = "forbidden"');
    expect(proposal).toContain("Nothing here is in effect until you");
    expect(proposal).toContain("[[sources]]");
    // Paths and digests of the samples, never their text.
    expect(proposal).not.toContain("token-ada");
    expect(await effectiveConventions(home, repo)).toBeNull();
  });

  it("marks what one sample shows as tentative", async () => {
    const proposal = await readFile(await learned(join(repo, "src", "auth.ts")), "utf8");
    expect(proposal).toMatch(/"exports" = "named" {2}# tentative: 1 of 1 site\(s\) in 1 file\(s\)/);
  });

  it("passes anything else to the verifier's own init", async () => {
    expect(await init("--seal", "test/**")).toBe(99);
  });
});

describe("approving, correcting and removing", () => {
  it("puts an approved proposal in effect for the project, and a fresh read finds it", async () => {
    await init("--approve", await learned());
    const effective = await effectiveConventions(home, repo);
    expect(effective?.rules).toMatchObject({ exports: "named", "function-names": "camelCase" });
    expect(effective?.origin.exports).toBe("project");
    expect((await readProfile(profilePath(home, repo)))?.sources.length).toBeGreaterThan(3);
    printed = "";
    await conventionsReport(repo);
    expect(printed).toContain("- exports: named. Exports are named, never default.");
    expect(printed).toContain(`sha256 ${effective?.sha256}`);
  });

  it("approves a proposal as the developer edited it, and refuses one edited to a value no rule has", async () => {
    const file = await learned();
    const text = await readFile(file, "utf8");
    await writeFile(file, text.replace('"exports" = "named"', '"exports" = "default"'));
    await init("--approve", file);
    expect((await effectiveConventions(home, repo))?.rules.exports).toBe("default");
    await writeFile(
      file,
      text.replace('"exports" = "named"', '"exports" = "whatever the model likes"'),
    );
    await expect(init("--approve", file)).rejects.toThrow(ProposalError);
    expect((await effectiveConventions(home, repo))?.rules.exports).toBe("default");
  });

  it("corrects one rule, adds guidance that is never checked, and forgets a rule", async () => {
    await init("--approve", await learned());
    await init("--set", "exports=default", "--set", "guidance=Comments say why, not what.");
    const corrected = await effectiveConventions(home, repo);
    expect(corrected?.rules.exports).toBe("default");
    expect(corrected?.guidance).toEqual(["Comments say why, not what."]);
    await init("--forget", "exports");
    expect((await effectiveConventions(home, repo))?.rules.exports).toBeUndefined();
    await expect(init("--set", "exports=sometimes")).rejects.toThrow(/exports/);
    await expect(init("--forget", "exports")).rejects.toThrow(/holds no such rule/);
  });

  it("lets a project override the global default, and says where the two disagree", async () => {
    await init("--set", "exports=default", "--set", "empty-catch=forbidden", "--global");
    await init("--set", "exports=named");
    const effective = await effectiveConventions(home, repo);
    expect(effective?.rules).toEqual({ exports: "named", "empty-catch": "forbidden" });
    expect(effective?.origin).toEqual({ exports: "project", "empty-catch": "global" });
    expect(effective?.conflicts).toEqual([
      "exports: this project's profile says named and the global profile says default; the project's applies",
    ]);
    printed = "";
    await conventionsReport(repo);
    expect(printed).toContain("conflict exports:");
  });

  it("refuses a profile file that does not validate instead of running without it", async () => {
    await init("--set", "exports=named");
    await writeFile(
      profilePath(home, repo),
      '{"version":"swarm.conventions/v1","rules":{"exports":"all of them"}}',
    );
    await expect(effectiveConventions(home, repo)).rejects.toThrow(ConventionProfileError);
  });
});

describe("the conventions a run works under", () => {
  it("lets the task's own words decide a rule it names, and says the rule is not checked this run", async () => {
    await init("--set", "exports=named", "--set", "function-names=camelCase");
    const plain = await runConventions(home, repo, "Add a download route.");
    expect(plain?.rules).toEqual({ exports: "named", "function-names": "camelCase" });
    expect(plain?.block).toContain("- exports: named.");
    const asked = await runConventions(home, repo, "Add a page module with a default export.");
    expect(asked?.rules).toEqual({ "function-names": "camelCase" });
    expect(asked?.notes.join("\n")).toMatch(
      /the task asks for default where the approved profile says exports: named/,
    );
  });
});
