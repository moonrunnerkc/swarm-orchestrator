import { execFileSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ContainmentError,
  childPath,
  isInside,
  listDirectoryInside,
  readFileInside,
  relativeSegments,
  removeFileInside,
  resolveWriteTargetInside,
  writeFileInside,
} from "./containment.mjs";
import { checkPathRefusal, listDirectory, readBudget, readFile } from "./reviewer-tools.mjs";

let base = "";
let root = "";
let sibling = "";
let outside = "";

/**
 * A checkout beside a prefix-colliding sibling and an unrelated outside directory, all real.
 * The temporary directory itself sits behind a symlink on macOS (/var -> /private/var), so the
 * root is deliberately named through one.
 */
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "containment-"));
  root = join(base, "checkout");
  sibling = join(base, "checkout-evil");
  outside = join(base, "outside");
  mkdirSync(join(root, "src", "nested"), { recursive: true });
  mkdirSync(join(root, "tests"), { recursive: true });
  mkdirSync(join(root, "node_modules"), { recursive: true });
  mkdirSync(sibling, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, "src", "nested", "file.txt"), "nested contents\n");
  writeFileSync(join(root, "tests", "changed.test.js"), "the author's test\n");
  writeFileSync(join(sibling, "secret.txt"), "sibling secret\n");
  writeFileSync(join(outside, "secret.txt"), "outside secret\n");
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("relativeSegments", () => {
  it("refuses parent traversal, however it is spelled", () => {
    for (const path of ["..", "../x", "a/../../x", "a/../b", "src/..", "./../x"])
      expect(() => relativeSegments(path), path).toThrow(ContainmentError);
  });

  it("refuses absolute, empty and NUL-bearing paths", () => {
    for (const path of [
      "/etc/passwd",
      join(sibling, "secret.txt"),
      "C:\\x",
      "\\\\host\\x",
      "",
      "a\0b",
    ])
      expect(() => relativeSegments(path), JSON.stringify(path)).toThrow(ContainmentError);
  });

  it("normalises `.` and doubled separators and keeps nested paths", () => {
    expect(relativeSegments("./src//nested/./file.txt")).toEqual(["src", "nested", "file.txt"]);
    expect(relativeSegments(".")).toEqual([]);
  });
});

describe("isInside and childPath", () => {
  it("does not treat a prefix-colliding sibling as inside", () => {
    expect(isInside(root, sibling)).toBe(false);
    expect(isInside(root, join(root, "src"))).toBe(true);
    expect(isInside(root, root)).toBe(true);
    expect(isInside(root, base)).toBe(false);
  });

  it("accepts one plain name and refuses anything else", () => {
    expect(childPath(root, "owner__repo-12")).toBe(join(root, "owner__repo-12"));
    for (const segment of ["", ".", "..", "a/b", "owner__../../x-1", "a\\b", "/abs", "a\0"])
      expect(() => childPath(root, segment), segment).toThrow(ContainmentError);
  });
});

describe("readFileInside", () => {
  it("reads a legitimate nested file and names its real relative path", () => {
    expect(readFileInside(root, "src/nested/file.txt")).toEqual({
      contents: "nested contents\n",
      relative: "src/nested/file.txt",
    });
  });

  it("refuses traversal into the prefix-colliding sibling and absolute paths", () => {
    expect(() => readFileInside(root, "../checkout-evil/secret.txt")).toThrow(ContainmentError);
    expect(() => readFileInside(root, join(sibling, "secret.txt"))).toThrow(ContainmentError);
  });

  it("refuses a symlink inside the checkout that points outside", () => {
    symlinkSync(join(outside, "secret.txt"), join(root, "src", "leak.txt"));
    symlinkSync(join(sibling, "secret.txt"), join(root, "src", "sibling.txt"));
    expect(() => readFileInside(root, "src/leak.txt")).toThrow(ContainmentError);
    expect(() => readFileInside(root, "src/sibling.txt")).toThrow(ContainmentError);
  });

  it("refuses a path through a symlinked directory component that leads outside", () => {
    symlinkSync(outside, join(root, "src", "linked"));
    expect(() => readFileInside(root, "src/linked/secret.txt")).toThrow(ContainmentError);
  });

  it("follows a symlink that stays inside and reports where it really read", () => {
    symlinkSync(join(root, "src", "nested"), join(root, "alias"));
    expect(readFileInside(root, "alias/file.txt")).toEqual({
      contents: "nested contents\n",
      relative: "src/nested/file.txt",
    });
  });

  it("refuses a FIFO without blocking on it", () => {
    execFileSync("mkfifo", [join(root, "src", "pipe")]);
    expect(() => readFileInside(root, "src/pipe")).toThrow(ContainmentError);
  });
});

describe("listDirectoryInside", () => {
  it("lists a legitimate nested directory, marking directories", () => {
    expect(listDirectoryInside(root, "src").sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "nested", directory: true },
    ]);
  });

  it("refuses listing outside through traversal, an absolute path or a symlinked directory", () => {
    expect(() => listDirectoryInside(root, "../checkout-evil")).toThrow(ContainmentError);
    expect(() => listDirectoryInside(root, sibling)).toThrow(ContainmentError);
    symlinkSync(outside, join(root, "src", "linked"));
    expect(() => listDirectoryInside(root, "src/linked")).toThrow(ContainmentError);
  });

  it("names a symlink leading outside without marking or following it", () => {
    symlinkSync(outside, join(root, "src", "linked"));
    symlinkSync(join(root, "tests"), join(root, "src", "inner"));
    const entries = Object.fromEntries(
      listDirectoryInside(root, "src").map((entry) => [entry.name, entry.directory]),
    );
    expect(entries).toEqual({ nested: true, linked: false, inner: true });
  });
});

describe("writeFileInside", () => {
  it("writes a legitimate nested file, creating the directories it needs", () => {
    const written = writeFileInside(root, "tests/new/deep/check.test.js", "check\n");
    expect(written.written).toBe(true);
    expect(readFileSync(join(root, "tests", "new", "deep", "check.test.js"), "utf8")).toBe(
      "check\n",
    );
    writeFileInside(root, "tests/new/deep/check.test.js", "shorter");
    expect(readFileSync(join(root, "tests", "new", "deep", "check.test.js"), "utf8")).toBe(
      "shorter",
    );
  });

  it("refuses traversal and absolute targets and writes nothing", () => {
    expect(() => writeFileInside(root, "../checkout-evil/planted.txt", "x")).toThrow(
      ContainmentError,
    );
    expect(() => writeFileInside(root, "a/../../outside/planted.txt", "x")).toThrow(
      ContainmentError,
    );
    expect(() => writeFileInside(root, join(outside, "planted.txt"), "x")).toThrow(
      ContainmentError,
    );
    expect(existsSync(join(sibling, "planted.txt"))).toBe(false);
    expect(existsSync(join(outside, "planted.txt"))).toBe(false);
  });

  it("refuses a final symlink that points outside and leaves its target untouched", () => {
    symlinkSync(join(outside, "secret.txt"), join(root, "tests", "check.test.js"));
    expect(() => writeFileInside(root, "tests/check.test.js", "overwritten")).toThrow(
      ContainmentError,
    );
    expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("outside secret\n");
  });

  it("refuses an existing symlinked directory component that leads outside", () => {
    symlinkSync(outside, join(root, "tests", "linked"));
    expect(() => writeFileInside(root, "tests/linked/secret.txt", "overwritten")).toThrow(
      ContainmentError,
    );
    expect(() => writeFileInside(root, "tests/linked/deeper/new.txt", "planted")).toThrow(
      ContainmentError,
    );
    expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("outside secret\n");
    expect(existsSync(join(outside, "deeper"))).toBe(false);
  });

  it("refuses a nonexistent target whose parent is a symlink to outside", () => {
    symlinkSync(outside, join(root, "tests", "linked"));
    expect(() => resolveWriteTargetInside(root, "tests/linked/new.txt")).toThrow(ContainmentError);
    expect(() => writeFileInside(root, "tests/linked/new.txt", "planted")).toThrow(
      ContainmentError,
    );
    expect(existsSync(join(outside, "new.txt"))).toBe(false);
  });

  it("refuses a parent that is a dangling symlink rather than creating its target", () => {
    symlinkSync(join(outside, "not-yet"), join(root, "tests", "dangling"));
    expect(() => writeFileInside(root, "tests/dangling/new.txt", "planted")).toThrow();
    expect(existsSync(join(outside, "not-yet"))).toBe(false);
  });

  it("refuses to write through a hard link", () => {
    linkSync(join(outside, "secret.txt"), join(root, "tests", "hard.txt"));
    expect(() => writeFileInside(root, "tests/hard.txt", "overwritten")).toThrow(ContainmentError);
    expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("outside secret\n");
  });

  it("leaves an existing file untouched when exclusive", () => {
    const result = writeFileInside(root, "src/nested/file.txt", "replaced", { exclusive: true });
    expect(result.written).toBe(false);
    expect(readFileSync(join(root, "src", "nested", "file.txt"), "utf8")).toBe("nested contents\n");
  });
});

describe("removeFileInside", () => {
  it("removes a legitimate nested file and treats an absent one as done", () => {
    expect(removeFileInside(root, "src/nested/file.txt")).toBe(true);
    expect(existsSync(join(root, "src", "nested", "file.txt"))).toBe(false);
    expect(removeFileInside(root, "src/nested/file.txt")).toBe(false);
  });

  it("refuses a parent that became a symlink to outside and keeps the outside file", () => {
    rmSync(join(root, "tests"), { recursive: true });
    symlinkSync(outside, join(root, "tests"));
    expect(() => removeFileInside(root, "tests/secret.txt")).toThrow(ContainmentError);
    expect(existsSync(join(outside, "secret.txt"))).toBe(true);
    expect(() => removeFileInside(root, "../outside/secret.txt")).toThrow(ContainmentError);
  });
});

describe("the adjudication reviewer's tools", () => {
  const forbidden = new Set(["tests/changed.test.js"]);

  it("list shows a nested directory and hides installed trees", () => {
    expect(listDirectory(root, ".").split("\n").sort()).toEqual(["src/", "tests/"]);
    expect(listDirectory(root, "src")).toBe("nested/");
  });

  it("list refuses outside paths and reports a missing one", () => {
    expect(listDirectory(root, "../checkout-evil")).toBe("outside the repository");
    expect(listDirectory(root, sibling)).toBe("outside the repository");
    symlinkSync(outside, join(root, "src", "linked"));
    expect(listDirectory(root, "src/linked")).toBe("outside the repository");
    expect(listDirectory(root, "missing")).toMatch(/^cannot list: /);
  });

  it("read returns a legitimate nested file and charges the budget", () => {
    const budget = { used: 0 };
    expect(readFile(root, "src/nested/file.txt", forbidden, budget)).toBe("nested contents\n");
    expect(budget.used).toBe("nested contents\n".length);
  });

  it("read refuses outside paths: traversal, sibling, absolute and symlinks", () => {
    const budget = { used: 0 };
    symlinkSync(join(outside, "secret.txt"), join(root, "src", "leak.txt"));
    symlinkSync(outside, join(root, "src", "linked"));
    for (const path of [
      "../checkout-evil/secret.txt",
      "src/../../outside/secret.txt",
      join(sibling, "secret.txt"),
      "src/leak.txt",
      "src/linked/secret.txt",
    ])
      expect(readFile(root, path, forbidden, budget), path).toBe("outside the repository");
    expect(budget.used).toBe(0);
  });

  it("read refuses a changed test file named directly, loosely or through a symlink", () => {
    const budget = { used: 0 };
    symlinkSync(join(root, "tests", "changed.test.js"), join(root, "src", "alias.js"));
    for (const path of ["tests/changed.test.js", "./tests//changed.test.js", "src/alias.js"])
      expect(readFile(root, path, forbidden, budget), path).toBe(
        "refused: this is a test file the pull request changed",
      );
    expect(budget.used).toBe(0);
  });

  it("read stops at the row's budget", () => {
    const budget = { used: readBudget };
    expect(readFile(root, "src/nested/file.txt", forbidden, budget)).toMatch(/read budget/);
  });

  it("finish refuses a check path outside the clone or on a changed file", () => {
    for (const path of ["../x.test.js", "a/../../x.test.js", "/tmp/x.test.js", ""])
      expect(checkPathRefusal(path, forbidden, []).refusal, path).toMatch(
        /not a path inside the repository/,
      );
    expect(checkPathRefusal("./tests/changed.test.js", forbidden, []).refusal).toMatch(
      /is a file the pull request changed/,
    );
    expect(checkPathRefusal("src/a.js", forbidden, ["src/a.js"]).refusal).toMatch(
      /is a file the pull request changed/,
    );
    expect(checkPathRefusal("a.test.js b.test.js", forbidden, []).refusal).toMatch(
      /not one plain repository-relative file path/,
    );
    expect(checkPathRefusal("./tests/new//check.test.js", forbidden, [])).toEqual({
      refusal: null,
      path: "tests/new/check.test.js",
    });
  });
});
