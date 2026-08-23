/**
 * Colour, and what stands in for it. Every status carries a word as well as a colour, because
 * a red cell and a green cell that differ only in hue exclude a meaningful share of readers,
 * and because `NO_COLOR` and a dumb terminal have to leave the screen legible rather than
 * merely uncoloured.
 */

export type ColorMode = "auto" | "always" | "never";

/** The colour names Ink resolves, plus 24-bit hex. Anything else is a typed error at the boundary. */
const namedColors: readonly string[] = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "gray",
  "grey",
  "blackBright",
  "redBright",
  "greenBright",
  "yellowBright",
  "blueBright",
  "magentaBright",
  "cyanBright",
  "whiteBright",
];

const hexColor = /^#[0-9a-fA-F]{6}$/;

export const themeSlots = [
  "accent",
  "passed",
  "failed",
  "advisory",
  "inactive",
  "muted",
  "selected",
] as const;

export type ThemeSlot = (typeof themeSlots)[number];

/** The one considered default. A second shipped theme is a maintenance cost with no reader. */
const defaultPalette: Readonly<Record<ThemeSlot, string>> = {
  accent: "cyan",
  passed: "green",
  failed: "red",
  advisory: "yellow",
  inactive: "gray",
  muted: "gray",
  selected: "blue",
};

export class UnknownThemeSlotError extends Error {
  constructor(slot: string) {
    super(`[theme] ${slot} is not a colour this build paints. Accepted: ${themeSlots.join(", ")}.`);
    this.name = "UnknownThemeSlotError";
  }
}

export class UnknownColorError extends Error {
  constructor(slot: string, value: string) {
    super(
      `[theme] ${slot} = "${value}" is not a colour. Accepted: ${namedColors.join(", ")}, ` +
        "or a hex colour such as #4c8bf5.",
    );
    this.name = "UnknownColorError";
  }
}

/** A status as it reaches a cell: the word always, the colour only where colour is on. */
export interface StatusStyle {
  readonly label: string;
  readonly color: string | undefined;
}

export interface Theme {
  readonly usesColor: boolean;
  readonly passed: StatusStyle;
  readonly failed: StatusStyle;
  readonly notApplicable: StatusStyle;
  readonly advisory: StatusStyle;
  color(slot: ThemeSlot): string | undefined;
}

export interface ThemeInput {
  readonly mode: ColorMode;
  /** The terminal's own name. "dumb" and an unset value both mean no colour under "auto". */
  readonly term: string | undefined;
  /** Set to anything at all, per the NO_COLOR convention, and colour is off under "auto". */
  readonly noColorSet: boolean;
  readonly isTty: boolean;
  readonly palette?: Readonly<Record<string, string>>;
}

/**
 * "always" and "never" are the user's decision and are taken literally. "auto" is the one that
 * reads the terminal, and it reads three things: a TTY at all, NO_COLOR, and a TERM that says
 * the terminal cannot do it.
 */
export function resolveTheme(input: ThemeInput): Theme {
  const palette = validatePalette(input.palette ?? {});
  const usesColor =
    input.mode === "always"
      ? true
      : input.mode === "never"
        ? false
        : input.isTty && !input.noColorSet && input.term !== "dumb" && input.term !== undefined;

  const color = (slot: ThemeSlot): string | undefined =>
    usesColor ? (palette[slot] ?? defaultPalette[slot]) : undefined;

  return {
    usesColor,
    passed: { label: "PASS", color: color("passed") },
    failed: { label: "FAIL", color: color("failed") },
    notApplicable: { label: "N/A", color: color("inactive") },
    advisory: { label: "WARN", color: color("advisory") },
    color,
  };
}

function validatePalette(raw: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  for (const [slot, value] of Object.entries(raw)) {
    if (!(themeSlots as readonly string[]).includes(slot)) {
      throw new UnknownThemeSlotError(slot);
    }
    if (!namedColors.includes(value) && !hexColor.test(value)) {
      throw new UnknownColorError(slot, value);
    }
  }
  return raw;
}
