import { describe, expect, it } from "vitest";
import { fileUrl, hyperlink, terminalSupportsHyperlinks } from "./hyperlink.ts";

const esc = String.fromCharCode(27);
const bel = String.fromCharCode(7);

/**
 * A path a person can click rather than copy, where the terminal understands OSC 8. Support is
 * read off the environment the terminal sets and never assumed: a terminal that does not
 * understand the sequence prints its bytes, which is worse than a plain path.
 */
describe("whether the terminal understands OSC 8 hyperlinks", () => {
  it("is known for the terminals that document it", () => {
    for (const env of [
      { TERM_PROGRAM: "iTerm.app" },
      { TERM_PROGRAM: "vscode" },
      { TERM_PROGRAM: "WezTerm" },
      { TERM_PROGRAM: "ghostty" },
      { TERM_PROGRAM: "Hyper" },
      { KITTY_WINDOW_ID: "1" },
      { WT_SESSION: "abc" },
      { VTE_VERSION: "6003" },
    ]) {
      expect(terminalSupportsHyperlinks(env)).toBe(true);
    }
  });

  it("is not assumed for Apple Terminal, an old VTE, a dumb terminal, or nothing at all", () => {
    expect(terminalSupportsHyperlinks({ TERM_PROGRAM: "Apple_Terminal" })).toBe(false);
    expect(terminalSupportsHyperlinks({ VTE_VERSION: "4999" })).toBe(false);
    expect(terminalSupportsHyperlinks({ TERM_PROGRAM: "iTerm.app", TERM: "dumb" })).toBe(false);
    expect(terminalSupportsHyperlinks({})).toBe(false);
  });
});

describe("a path as a link", () => {
  it("spells a file URL with the characters a path can carry escaped", () => {
    expect(fileUrl("/Users/brad/.swarm/sessions/2026 09/bundle/review.html")).toBe(
      "file:///Users/brad/.swarm/sessions/2026%2009/bundle/review.html",
    );
  });

  it("wraps the visible text in the OSC 8 open and close sequences", () => {
    expect(hyperlink("review.html", "file:///tmp/review.html")).toBe(
      `${esc}]8;;file:///tmp/review.html${bel}review.html${esc}]8;;${bel}`,
    );
  });
});
