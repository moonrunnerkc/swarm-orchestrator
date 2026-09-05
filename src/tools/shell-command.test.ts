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
