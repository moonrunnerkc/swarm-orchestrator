import { parse } from "smol-toml";
import {
  type ConventionRule,
  conventionProposal,
  conventionText,
  type SourceText,
} from "swarm-verify";
import { type ConventionProfile, profileSchema, profileVersion } from "./profile.ts";

export class ProposalError extends Error {
  constructor(detail: string) {
    super(`the proposal cannot be approved: ${detail}`);
    this.name = "ProposalError";
  }
}

/**
 * A proposal of conventions as a file a person edits and then approves. The verifier counts the
 * samples and says what they support; this lays it out, with what was observed and not proposed,
 * what the repository's own configuration settles, and what is unsafe and never learned.
 */
export async function proposeConventions(
  samples: readonly SourceText[],
  repository: string,
): Promise<string> {
  const found = await conventionProposal(samples, repository);
  const commented = (title: string, lines: readonly string[]) =>
    lines.length === 0 ? [] : ["", `# ${title}`, ...lines.map((line) => `#   ${line}`)];
  return [
    `# Coding conventions proposed from ${found.files} file(s). Nothing here is in effect until you`,
    "# approve it:  swarm init --approve <this file> [--global]",
    "# Edit it first: delete a line to leave a rule out, or change a value to another one listed.",
    "# A rule in effect is checked on the files a run adds or changes.",
    "",
    `version = "${profileVersion}"`,
    "# Preferences nothing can measure (how much to comment, how to phrase an error). The model",
    "# reads them; nothing checks them and no report calls them proven.",
    "guidance = []",
    "",
    "[rules]",
    ...found.proposed.map(
      (one) =>
        `${JSON.stringify(one.rule)} = ${JSON.stringify(one.value)}  # ${one.basis}. One of: ${one.values.join(", ")}`,
    ),
    ...commented("Observed and not proposed, because the samples are mixed:", found.observed),
    ...commented(
      "Left to this repository's own configuration, which already decides them:",
      found.settled.map((one) => `${one.rule}: ${one.value} (${one.by})`),
    ),
    ...commented("Samples that disagree with that configuration:", found.conflicts),
    "",
    `# Formatting (quotes, semicolons, indentation) is never proposed: ${found.formatter ?? "no formatter configuration was found, and none"} owns it.`,
    ...commented(
      "Seen in the samples and never learned, because it is unsafe. Each with its safe form:",
      found.unsafe.map((one) => `${one.path}:${one.line} ${one.detail} ${one.safer}`),
    ),
    ...found.sources.flatMap((one) => [
      "",
      "[[sources]]",
      `path = ${JSON.stringify(one.path)}`,
      `sha256 = "${one.sha256}"`,
    ]),
    "",
  ].join("\n");
}

/** A proposal file as a profile, validated: what `--approve` puts in effect. */
export function proposalProfile(text: string, approvedAt: string): ConventionProfile {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    throw new ProposalError(`it is not TOML (${(error as Error).message.split("\n")[0]})`);
  }
  const parsed = profileSchema.safeParse({ ...(raw as object), approvedAt });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ProposalError(`${issue?.path.join(".") || "it"} ${issue?.message ?? ""}`.trim());
  }
  return parsed.data;
}

/** A profile's rules and guidance as lines a person or the model reads. */
export function conventionLines(profile: {
  readonly rules: ConventionProfile["rules"];
  readonly guidance: readonly string[];
}): string[] {
  return [
    ...Object.entries(profile.rules).flatMap(([rule, value]) =>
      value === undefined
        ? []
        : [`- ${rule}: ${value}. ${conventionText(rule as ConventionRule, value)}`],
    ),
    ...profile.guidance.map((line) => `- (guidance, not checked) ${line}`),
  ];
}
