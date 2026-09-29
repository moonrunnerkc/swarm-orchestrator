import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PatchPathError, pathsInPatch, readPatchFiles, readQuotedPath } from "./patch-paths.ts";
import { parseUnifiedDiff, reconstructSides } from "./unified-diff.ts";

let root = "";

function git(...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=fixture", "-c", "user.email=fixture@example.test", ...args],
    { cwd: root, encoding: "utf8" },
  );
}

const quoted = 'café "x".js';
const tabbed = "a\tb.js";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-patch-paths-"));
  git("init", "-q");
  await writeFile(join(root, "my file.js"), "one\n");
  await writeFile(join(root, "gone file.js"), "gone\n");
  await writeFile(join(root, "old name.js"), "a\nb\nc\nd\ne\nf\n");
  await writeFile(join(root, "same name.js"), "same\n");
  await writeFile(join(root, quoted), "q\nq2\nq3\n");
  await writeFile(join(root, "moved.js"), "m\nm2\nm3\n");
  await writeFile(join(root, "mode file.sh"), "echo\n");
  await writeFile(join(root, "copy src.js"), "c1\nc2\nc3\nc4\n");
  await writeFile(join(root, "tail b.js"), "tail\n");
  await writeFile(join(root, tabbed), "tab\n");
  await writeFile(join(root, "bin file.dat"), Buffer.from([0, 1, 2]));
  git("add", "-A");
  git("commit", "-qm", "base");

  await writeFile(join(root, "my file.js"), "two\n");
  await rm(join(root, "gone file.js"));
  await rename(join(root, "old name.js"), join(root, "new name.js"));
  await writeFile(join(root, "new name.js"), "a\nb\nc\nd\ne\nF\n");
  await rename(join(root, "same name.js"), join(root, "renamed same.js"));
  await writeFile(join(root, quoted), "q\nQ2\nq3\n");
  await mkdir(join(root, "dir é"));
  await rename(join(root, "moved.js"), join(root, "dir é", 'ré "n".js'));
  await chmod(join(root, "mode file.sh"), 0o755);
  await writeFile(join(root, "copy dst.js"), "c1\nc2\nc3\nc4\n");
  await writeFile(join(root, "added file.js"), "added\n");
  // Git's header for this rename, `a/tail b.js b/tail b.js b`, splits at more than one ` b/`.
  await rename(join(root, "tail b.js"), join(root, "tail b.js b"));
  await writeFile(join(root, tabbed), "tab2\n");
  await writeFile(join(root, "bin file.dat"), Buffer.from([0, 1, 3]));
  await writeFile(join(root, "new bin.dat"), Buffer.from([0, 5]));
  git("add", "-A");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const withRenames = [
  { oldPath: tabbed, newPath: tabbed, change: "modified", header: "git" },
  { oldPath: null, newPath: "added file.js", change: "added", header: "git" },
  { oldPath: "bin file.dat", newPath: "bin file.dat", change: "modified", header: "git" },
  { oldPath: quoted, newPath: quoted, change: "modified", header: "git" },
  { oldPath: "copy src.js", newPath: "copy dst.js", change: "copied", header: "git" },
  { oldPath: "gone file.js", newPath: null, change: "deleted", header: "git" },
  { oldPath: "mode file.sh", newPath: "mode file.sh", change: "modified", header: "git" },
  { oldPath: "moved.js", newPath: 'dir é/ré "n".js', change: "renamed", header: "git" },
  { oldPath: "my file.js", newPath: "my file.js", change: "modified", header: "git" },
  { oldPath: null, newPath: "new bin.dat", change: "added", header: "git" },
  { oldPath: "old name.js", newPath: "new name.js", change: "renamed", header: "git" },
  { oldPath: "same name.js", newPath: "renamed same.js", change: "renamed", header: "git" },
  { oldPath: "tail b.js", newPath: "tail b.js b", change: "renamed", header: "git" },
];

describe("reading paths from patches git itself wrote", () => {
  it("reads every header form under the default quoting and agrees with core.quotePath=false", () => {
    const patch = git("diff", "--cached", "-M", "-C", "--find-copies-harder");
    // The forms under test, exactly as this git wrote them.
    expect(patch).toContain('diff --git "a/caf\\303\\251 \\"x\\".js" "b/caf\\303\\251 \\"x\\".js"');
    expect(patch).toContain('--- "a/caf\\303\\251 \\"x\\".js"\t\n');
    expect(patch).toContain("diff --git a/my file.js b/my file.js\n");
    expect(patch).toContain("+++ b/my file.js\t\n");
    expect(patch).toContain("diff --git a/tail b.js b/tail b.js b\n");
    expect(patch).toContain('rename to "dir \\303\\251/r\\303\\251 \\"n\\".js"\n');
    expect(patch).toContain('diff --git "a/a\\tb.js" "b/a\\tb.js"');
    expect(patch).toContain("Binary files a/bin file.dat and b/bin file.dat differ");

    const files = readPatchFiles(patch);
    expect(files).toHaveLength(withRenames.length);
    expect(files).toEqual(expect.arrayContaining(withRenames));
    expect(
      readPatchFiles(git("-c", "core.quotePath=false", "diff", "--cached", "-M", "-C")),
    ).toEqual(expect.arrayContaining(withRenames.filter((file) => file.change !== "copied")));
  });

  it("reads the binary, rename-free form the change source produces", () => {
    const patch = git(
      "-c",
      "core.quotePath=true",
      "diff",
      "--cached",
      "--binary",
      "--full-index",
      "--no-renames",
    );
    expect(patch).toContain("GIT binary patch");
    expect(pathsInPatch(patch)).toEqual(
      [
        tabbed,
        "added file.js",
        "bin file.dat",
        quoted,
        "copy dst.js",
        'dir é/ré "n".js',
        "gone file.js",
        "mode file.sh",
        "moved.js",
        "my file.js",
        "new bin.dat",
        "new name.js",
        "old name.js",
        "renamed same.js",
        "same name.js",
        "tail b.js",
        "tail b.js b",
      ].sort(),
    );
  });

  it("names the same changed files in measurement as in the scope checks", () => {
    const patch = git("diff", "--cached", "-M");
    const measured = parseUnifiedDiff(patch).map((file) => file.path);
    const scoped = readPatchFiles(patch).map((file) => file.newPath ?? file.oldPath);
    expect(measured.sort()).toEqual(scoped.sort());
    expect(parseUnifiedDiff(patch).find((file) => file.path === "my file.js")?.addedLines).toEqual([
      { line: 1, text: "two" },
    ]);
    expect(reconstructSides(patch).get(quoted)).toEqual({
      base: "q\nq2\nq3",
      head: "q\nQ2\nq3",
    });
  });
});

describe("decoding git's C-style quoting", () => {
  it("decodes every named escape and octal bytes as UTF-8", () => {
    const text = String.raw`"x\a\b\t\n\v\f\r\"\\\303\251\342\202\254"`;
    expect(readQuotedPath(text, 0)).toEqual({
      path: 'x\x07\b\t\n\v\f\r"\\é€',
      end: text.length,
    });
  });

  it.each([
    [String.raw`"a\q"`, "unknown escape"],
    ['"a/unterminated', "closing quote"],
    [String.raw`"a\377"`, "not UTF-8"],
  ])("refuses %s", (text, reason) => {
    expect(() => readQuotedPath(text, 0)).toThrow(reason);
  });
});

describe("refusing what cannot be read with certainty", () => {
  const hunk = ["@@ -1 +1 @@", "-a", "+b", ""];

  it("refuses a bare header that splits two ways when nothing else names its paths", () => {
    expect(() =>
      pathsInPatch("diff --git a/x b/y b/z\nold mode 100644\nnew mode 100755\n"),
    ).toThrow(PatchPathError);
    expect(
      pathsInPatch(
        "diff --git a/x b/y b/z\nsimilarity index 100%\nrename from x\nrename to y b/z\n",
      ),
    ).toEqual(["x", "y b/z"]);
  });

  it("refuses naming lines that disagree with the header or each other", () => {
    for (const patch of [
      ['diff --git "a/my file.js" "b/my file.js"', "--- a/my file.js", "+++ b/other.js", ...hunk],
      ["diff --git a/x b/x", "--- a/x", "--- a/y", "+++ b/x", ...hunk],
      ["diff --git a/x b/x", "rename from x", ...hunk],
      ["diff --git a/x b/y", "new file mode 100644", "--- /dev/null", "+++ b/y", ...hunk],
      ["diff --git x y", "--- x", "+++ y", ...hunk],
      ['diff --git "a/x\\q" "b/x"', ...hunk],
    ])
      expect(() => pathsInPatch(patch.join("\n")), patch[0]).toThrow(PatchPathError);
  });

  it("keeps a removed line that reads like a header as content", () => {
    const patch = [
      "diff --git a/notes.md b/notes.md",
      "--- a/notes.md",
      "+++ b/notes.md",
      "@@ -1,2 +1,2 @@",
      "--- a/elsewhere.md",
      "+++ b/elsewhere.md",
      "",
    ].join("\n");
    expect(pathsInPatch(patch)).toEqual(["notes.md"]);
  });

  it("reads a bare section after the last hunk, which git apply applies as a further file", () => {
    const patch = [
      "diff --git a/safe.js b/safe.js",
      "--- a/safe.js",
      "+++ b/safe.js",
      ...hunk.slice(0, -1),
      "--- a/evil.js",
      "+++ b/evil.js",
      ...hunk,
    ].join("\n");
    expect(readPatchFiles(patch).map((file) => [file.newPath, file.header])).toEqual([
      ["safe.js", "git"],
      ["evil.js", "traditional"],
    ]);
  });
});
