import { createHash } from "node:crypto";
import type { PlatformProbe } from "./platform-probe.ts";

/** The most the block may take of the stable prefix; the layout gives way first. */
export const platformBlockBytes = 4_000;

const layoutKept = 40;
const nameKept = 80;

export type Flavor = "GNU" | "BSD" | "BusyBox" | "mawk" | "unidentified" | "missing";

export interface ToolFlavor {
  readonly flavor: Flavor;
  /** The version line it was read from, or the behavior that decided it. */
  readonly evidence: string;
  /** No version line named it, and a probed behavior did. */
  readonly byBehavior: boolean;
}

export const probedTools = ["sed", "grep", "find", "awk", "xargs"] as const;
export type ProbedTool = (typeof probedTools)[number];

// Where no version line names the flavor, one behavior only the BSD form has decides it.
const bsdBehavior: Partial<Record<ProbedTool, readonly [string, string, string]>> = {
  sed: ["sed.inplace", "suffix", "sed -i takes the next argument as a backup suffix"],
  find: ["find.printf", "no", "find has no -printf"],
  xargs: ["xargs.J", "yes", "xargs takes -J"],
};

export function toolFlavor(tool: ProbedTool, facts: Readonly<Record<string, string>>): ToolFlavor {
  const read = (flavor: Flavor, evidence: string) => ({ flavor, evidence, byBehavior: false });
  if ((facts[`tool.${tool}.path`] ?? "") === "") return read("missing", "");
  const version = facts[`tool.${tool}.version`] ?? "";
  if (/busybox/i.test(version)) return read("BusyBox", version);
  // "BSD grep, GNU compatible" is BSD: the BSD test comes first.
  if (/\bBSD\b/.test(version)) return read("BSD", version);
  if (/\bGNU\b/.test(version)) return read("GNU", version);
  if (tool === "awk") {
    // The one true awk, which macOS and the BSDs ship, prints its date as its version.
    if (/^awk version \d{8}/.test(version)) return read("BSD", version);
    const w = facts["tool.awk.w"] ?? "";
    if (/^mawk\b/.test(w)) return read("mawk", w);
  }
  const behavior = bsdBehavior[tool];
  if (behavior !== undefined && facts[behavior[0]] === behavior[1]) {
    return { flavor: "BSD", evidence: behavior[2], byBehavior: true };
  }
  return read("unidentified", version);
}

function system(facts: Readonly<Record<string, string>>): string {
  const [kernel = "unknown", release = "", arch = ""] = (facts.uname ?? "").split(" ");
  const name =
    facts.macos !== undefined
      ? `macOS ${facts.macos}`
      : (facts.linux ?? (kernel === "unknown" ? "an unidentified system" : kernel));
  const shell =
    (facts["sh.bash"] ?? "") !== ""
      ? `bash ${(facts["sh.bash"] ?? "").replace(/\(.*$/, "")}`
      : (facts["sh.zsh"] ?? "") !== ""
        ? `zsh ${facts["sh.zsh"]}`
        : (facts["sh.link"] ?? "") !== ""
          ? (facts["sh.link"] ?? "").split("/").at(-1)
          : "a POSIX sh the probe could not name";
  return `- System: ${name} (${[kernel, release, arch].filter((part) => part !== "").join(" ")}). /bin/sh is ${shell}.`;
}

function toolLine(tool: ProbedTool, facts: Readonly<Record<string, string>>): string {
  const { flavor, evidence, byBehavior } = toolFlavor(tool, facts);
  if (flavor === "missing") return `- ${tool}: not found.`;
  const notes: string[] = [];
  if (tool === "sed" && facts["sed.inplace"] === "suffix") {
    notes.push("sed -i needs a suffix argument here: sed -i '' 's/a/b/' file");
  }
  if (tool === "grep" && facts["grep.P"] === "no") notes.push("no -P");
  if (tool === "find" && facts["find.printf"] === "no") notes.push("no -printf");
  // A behavior that decided the flavor is said once, as the note it also is, or in brackets.
  const said =
    evidence === "" || (byBehavior && notes.length > 0) ? "" : ` (${evidence.slice(0, 80)})`;
  return `- ${tool}: ${flavor}${said}${notes.length > 0 ? `; ${notes.join("; ")}` : ""}.`;
}

const versionOf = (line: string) => line.match(/\d+(?:\.\d+)+[\w.+-]*/)?.[0] ?? line.slice(0, 40);

function programs(facts: Readonly<Record<string, string>>): string[] {
  const keyed = (prefix: string) =>
    Object.entries(facts)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key.slice(prefix.length), value] as const);
  const present = keyed("have.").map(([name, line]) => `${name} ${versionOf(line)}`);
  const broken = keyed("broken.").map(([name]) => name);
  const containers = keyed("container.").map(([name]) => name);
  return [
    `- Programs found: ${present.join(", ") || "none of those probed"}.`,
    ...(broken.length > 0 ? [`- On PATH but failing to start: ${broken.join(", ")}.`] : []),
    `- Container runtimes on PATH: ${containers.join(", ") || "none"}.`,
  ];
}

/** The block's last paragraph: how the coding model changes files. A reviewer changes none. */
export const editAdvice = [
  "Change a file's text with an edit or write block, not with sed, awk, perl or a shell",
  "redirection: those blocks behave the same on every platform. Keep bash for running programs,",
  "reading files, and moving or deleting them.",
].join("\n");

/** The block's facts alone, for a prompt whose reply is a command and never a change to a file. */
export function machineFacts(block: string): string {
  const advice = `\n${editAdvice}`;
  return block.endsWith(advice) ? block.slice(0, -advice.length) : block;
}

/**
 * The machine as the model's commands meet it, said once at the head of the prompt. Only what
 * the probe saw is stated; a tool it could not place is called unidentified, never guessed.
 */
export function renderPlatform(input: {
  readonly probe: PlatformProbe;
  readonly root: string;
  readonly checks: "isolated" | "host";
}): string {
  const { facts } = input.probe;
  const head = [
    "This machine, probed when the run started. Your commands run here, with /bin/sh -c:",
    system(facts),
    ...probedTools.map((tool) => toolLine(tool, facts)),
    ...programs(facts),
    input.checks === "isolated"
      ? "- The verifier runs the project's checks in a Linux container, not on this machine."
      : "- The verifier runs the project's checks on this machine.",
    ...(input.probe.cut
      ? ["- The probe ran out of time; what it did not reach is not listed."]
      : []),
  ];
  const names = input.probe.layout.map((name) =>
    name.length > nameKept ? `${name.slice(0, nameKept)}...` : name,
  );
  for (let kept = Math.min(names.length, layoutKept); ; kept -= 1) {
    const rest = names.length - kept;
    const layout = `- Repository root, where commands start: ${input.root}. Its entries: ${names.slice(0, kept).join(" ") || "none"}${rest > 0 ? ` (and ${rest} more)` : ""}.`;
    const block = [...head, layout, editAdvice].join("\n");
    if (Buffer.byteLength(block) <= platformBlockBytes || kept === 0) return block;
  }
}

export const platformSha256 = (block: string) => createHash("sha256").update(block).digest("hex");
