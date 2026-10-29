import { describe, expect, it } from "vitest";
import { readShellCommand } from "./shell-command.ts";

describe("reading a shell command without a shell", () => {
  it("names every command a chain would run", () => {
    expect(readShellCommand("npm test && git status")?.executables).toEqual(["npm", "git"]);
    expect(readShellCommand("cat a | head -2 ; ls")?.executables).toEqual(["cat", "head", "ls"]);
  });

  it("names the words that could be a path, so the guard can rule on them", () => {
    expect(readShellCommand("cat ~/.ssh/id_rsa")?.operands).toContain("~/.ssh/id_rsa");
    expect(readShellCommand("cat package.json")?.operands).toEqual(["package.json"]);
  });

  it("keeps a redirect target, which is a file the command writes", () => {
    expect(readShellCommand("npm test > out.txt")?.operands).toEqual(["test", "out.txt"]);
    expect(readShellCommand("cat a >> ~/.ssh/authorized_keys")?.operands).toContain(
      "~/.ssh/authorized_keys",
    );
  });

  it("reads a descriptor duplicate as the descriptor it is, not as a file", () => {
    const read = readShellCommand("npm test 2>&1");
    expect(read?.executables).toEqual(["npm"]);
    expect(read?.operands).toEqual(["test"]);
  });

  it("refuses the strings whose meaning only a shell knows", () => {
    for (const command of [
      "echo $(whoami)",
      "echo `whoami`",
      "cat $SECRET",
      "npm test &",
      "(npm test)",
      "cat 'unterminated",
      'cat "un$terminated"',
      "cat ~root/.ssh/id_rsa",
      "cat file \\",
    ]) {
      expect(readShellCommand(command), command).toBeNull();
    }
  });

  it("reads quoted words as one word each", () => {
    const read = readShellCommand(`git commit -m "a message with spaces"`);
    expect(read?.executables).toEqual(["git"]);
    expect(read?.operands).toContain("a message with spaces");
  });

  it("has nothing to say about an empty string", () => {
    expect(readShellCommand("   ")).toBeNull();
  });
});

describe("a quoted word that holds a script", () => {
  it("is not itself offered as a path, while the paths inside it still are", () => {
    const read = readShellCommand(
      `node -e "\nconst fs = require('fs');\nconsole.log(fs.readFileSync('~/.ssh/id_rsa'))\n"`,
    );
    expect(read?.executables).toEqual(["node"]);
    // The whole script was refused as a path holding a control character; it is no path at all.
    expect(read?.operands.some((operand) => operand.includes("\n"))).toBe(false);
    // What the script names is still checked.
    expect(read?.operands.some((operand) => operand.includes("~/.ssh/id_rsa"))).toBe(true);
  });
});

describe("punctuation inside a script word", () => {
  it("is not offered as a path, while a bare slash as the whole word still is", () => {
    const read = readShellCommand(
      `node -e "const a = 1 / 2; // half\nconsole.log(require('./lib/index.js'))"`,
    );
    expect(read?.operands).not.toContain("/");
    expect(read?.operands).not.toContain("//");
    expect(read?.operands.some((operand) => operand.includes("./lib/index.js"))).toBe(true);
    // The word on its own names the root, and is still checked as a path.
    expect(readShellCommand("ls /")?.operands).toEqual(["/"]);
  });
});

describe("a program passed inline to an interpreter", () => {
  it("offers only what is shaped like a path, from its words and its relative literals", () => {
    const operands =
      readShellCommand(
        'node -e \'const m = /^.*\\./.exec(name); // why\nload("./lib/a.js", "/api/users"); f( ~/.ssh/id_rsa )\'',
      )?.operands ?? [];
    expect(operands).toContain("~/.ssh/id_rsa");
    expect(operands).toContain("./lib/a.js");
    for (const code of ["/^.*\\./.exec(name);", "//", "/api/users", 'load("./lib/a.js",'])
      expect(operands).not.toContain(code);
    expect(operands.some((operand) => operand.includes("\n"))).toBe(false);
  });

  it("reads only the argument after the inline flag as code, for node and python", () => {
    const node = readShellCommand("node --input-type=module -e 'x(/a\\/b/)' ../outside.js");
    expect(node?.operands).toContain("../outside.js");
    expect(node?.operands).not.toContain("x(/a/b/)");
    const python = readShellCommand("python3 -c 'import re; re.match(r\"^/a/b\", s)'");
    expect(python?.operands.some((operand) => operand.includes("/a/b"))).toBe(false);
    // Not an inline flag: the word is offered whole and in pieces, as before.
    expect(readShellCommand("sed -n 'w /home/dev/.ssh/authorized_keys'")?.operands).toContain(
      "/home/dev/.ssh/authorized_keys",
    );
  });
});

describe("comments inside a program passed inline", () => {
  it("does not offer a path that only a comment names", () => {
    const operands =
      readShellCommand(
        "node -e \"const m = require('./lib');\n// e.g., /a/b matching /**/a/x/y\n/* block: see /etc/hosts\n   and ~/.ssh/config */\nconsole.log(m('/a/b/c'));\"",
      )?.operands ?? [];
    expect(operands).toContain("./lib");
    for (const commented of ["/a/b", "/etc/hosts", "~/.ssh/config", "hosts"])
      expect(operands, commented).not.toContain(commented);
  });

  it("keeps what comes after a comment marker inside a string or a regular expression", () => {
    // The `//` in the URL, the `//` matched by the regular expression and the `/*` in the
    // string open no comment: the home path on the line after each is still offered.
    const operands =
      readShellCommand(
        'node -e \'const url = "http://x//y"; f( ~/.ssh/id_rsa )\nconst r = /\\/\\//; f( ~/.aws/credentials )\nconst t = "/* open"; load("./lib/a.js")\'',
      )?.operands ?? [];
    expect(operands).toContain("~/.ssh/id_rsa");
    expect(operands).toContain("~/.aws/credentials");
    expect(operands).toContain("./lib/a.js");
  });

  it("reads a string with spaces as the one literal it is: absolute paths inside it are data, relative ones are offered", () => {
    const operands =
      readShellCommand(
        'node -e \'console.log("Without partial /a vs b:", r); read("the file ./notes.txt and ~/.ssh/id_rsa")\'',
      )?.operands ?? [];
    expect(operands).not.toContain("/a");
    expect(operands).toContain("./notes.txt");
    expect(operands).toContain("~/.ssh/id_rsa");
  });

  it("reads a division as code, so what follows it on the line is still read", () => {
    const operands =
      readShellCommand("node -e 'const n = total / 2 / x; f( ~/.aws/credentials ) // /etc/hosts'")
        ?.operands ?? [];
    expect(operands).toContain("~/.aws/credentials");
    expect(operands).not.toContain("/etc/hosts");
  });

  it("reads a regular expression after a keyword as one, and the comment after it as a comment", () => {
    const operands =
      readShellCommand(
        "node -e 'if (/\\/\\//.test(s)) f( ~/.aws/credentials ); // see /etc/hosts\nreturn /a/.test(x) // and /etc/passwd'",
      )?.operands ?? [];
    expect(operands).toContain("~/.aws/credentials");
    expect(operands).not.toContain("/etc/hosts");
    expect(operands).not.toContain("/etc/passwd");
  });

  it("drops a python hash comment and keeps the hash inside a string", () => {
    const operands =
      readShellCommand(
        'python3 -c \'open("./data.txt")  # was /etc/passwd\ns = "# ~/.ssh/id_rsa"; f( ~/.aws/credentials )\'',
      )?.operands ?? [];
    expect(operands).toContain("./data.txt");
    expect(operands).toContain("~/.aws/credentials");
    expect(operands).not.toContain("/etc/passwd");
    expect(operands).not.toContain("passwd");
  });

  it("falls back to reading everything where the code cannot be read to its end", () => {
    // An unterminated string: nothing after it is known to be code or comment, so every
    // path-shaped piece is offered, as before.
    const operands =
      readShellCommand("node -e 'const s = \"open; // ~/.ssh/id_rsa'")?.operands ?? [];
    expect(operands).toContain("~/.ssh/id_rsa");
  });
});

describe("a heredoc", () => {
  it("is data for the command, so its body names no path and runs no program", () => {
    expect(readShellCommand("cat > half.mjs <<'EOF'\nexport const half = 1;\nEOF")).toEqual({
      executables: ["cat"],
      operands: ["half.mjs"],
    });
    expect(readShellCommand("cat <<-EOF > b.txt\n\thi\n\tEOF\nls")?.executables).toEqual([
      "cat",
      "ls",
    ]);
  });

  it("is read as the program when an interpreter is handed it", () => {
    expect(
      readShellCommand("python3 - <<'PY'\nprint(open('.env').read())\nPY")?.operands,
    ).toContain(".env");
  });

  it("is unreadable where it would expand, where it never ends, or where a shell runs it", () => {
    expect(readShellCommand("cat > a.js <<EOF\nconst user = $(whoami)\nEOF")).toBeNull();
    expect(readShellCommand("cat <<EOF\nno end")).toBeNull();
    expect(readShellCommand("bash <<EOF\nls\nEOF")).toBeNull();
    expect(readShellCommand("cat <<< hi")).toBeNull();
  });
});
