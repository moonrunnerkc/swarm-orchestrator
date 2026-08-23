import { describe, expect, it } from "vitest";
import { resolveTheme, UnknownColorError, UnknownThemeSlotError } from "./theme.ts";

const onATerminal = { term: "xterm-256color", noColorSet: false, isTty: true } as const;

describe("when colour is on", () => {
  it("paints on a colour terminal under auto", () => {
    expect(resolveTheme({ mode: "auto", ...onATerminal }).usesColor).toBe(true);
  });

  it("takes an explicit choice literally, in both directions", () => {
    expect(
      resolveTheme({ mode: "always", term: "dumb", noColorSet: true, isTty: false }).usesColor,
    ).toBe(true);
    expect(resolveTheme({ mode: "never", ...onATerminal }).usesColor).toBe(false);
  });

  it("stops at NO_COLOR, a dumb terminal, no terminal, and no TERM at all", () => {
    const off = [
      { mode: "auto", term: "xterm-256color", noColorSet: true, isTty: true },
      { mode: "auto", term: "dumb", noColorSet: false, isTty: true },
      { mode: "auto", term: "xterm-256color", noColorSet: false, isTty: false },
      { mode: "auto", term: undefined, noColorSet: false, isTty: true },
    ] as const;

    for (const input of off) {
      expect(resolveTheme(input).usesColor).toBe(false);
    }
  });
});

describe("legibility without colour", () => {
  /**
   * A red cell and a green cell that differ only in hue exclude a meaningful share of
   * readers, so every status carries a word whether or not it is painted.
   */
  it("keeps a distinct word on every status, coloured or not", () => {
    for (const mode of ["always", "never"] as const) {
      const theme = resolveTheme({ mode, ...onATerminal });
      const labels = [
        theme.passed.label,
        theme.failed.label,
        theme.notApplicable.label,
        theme.advisory.label,
      ];

      expect(new Set(labels).size).toBe(labels.length);
      for (const label of labels) {
        expect(label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("hands out no colour at all when colour is off, so nothing can leak one", () => {
    const theme = resolveTheme({ mode: "never", ...onATerminal });
    expect(theme.passed.color).toBeUndefined();
    expect(theme.failed.color).toBeUndefined();
    expect(theme.color("accent")).toBeUndefined();
    expect(theme.color("muted")).toBeUndefined();
  });
});

describe("the theme table in swarm.toml", () => {
  it("takes a named colour and a hex colour for a slot", () => {
    expect(
      resolveTheme({ mode: "always", ...onATerminal, palette: { passed: "cyanBright" } }).passed
        .color,
    ).toBe("cyanBright");
    expect(
      resolveTheme({ mode: "always", ...onATerminal, palette: { accent: "#4c8bf5" } }).color(
        "accent",
      ),
    ).toBe("#4c8bf5");
  });

  it("names the slot and the accepted set when the slot does not exist", () => {
    expect(() =>
      resolveTheme({ mode: "always", ...onATerminal, palette: { headline: "red" } }),
    ).toThrow(UnknownThemeSlotError);
    expect(() =>
      resolveTheme({ mode: "always", ...onATerminal, palette: { headline: "red" } }),
    ).toThrow(/accent, passed, failed/);
  });

  it("names the value and the accepted set when the colour does not exist", () => {
    expect(() =>
      resolveTheme({ mode: "always", ...onATerminal, palette: { passed: "chartreuse" } }),
    ).toThrow(UnknownColorError);
    expect(() =>
      resolveTheme({ mode: "always", ...onATerminal, palette: { passed: "#12345" } }),
    ).toThrow(UnknownColorError);
  });

  it("validates the palette even where colour is off, so a bad file is not found later", () => {
    expect(() =>
      resolveTheme({ mode: "never", ...onATerminal, palette: { passed: "chartreuse" } }),
    ).toThrow(UnknownColorError);
  });
});
