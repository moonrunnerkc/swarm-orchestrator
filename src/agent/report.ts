import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RequirementOutcome } from "swarm-verify";
import type { Finalized } from "./finalize.ts";
import type { LoadedInstruction } from "./instructions.ts";

export const reportVersion = "swarm-orchestrator.report/v1";

export interface RunReportFile {
  readonly version: typeof reportVersion;
  readonly task: string;
  readonly model: { readonly name: string; readonly reason: string };
  readonly stop: string;
  readonly reason: string | null;
  readonly state: Finalized["state"];
  readonly snapshot: {
    readonly base: string;
    readonly patchSha256: string;
    readonly patch: string;
    readonly treeSha256: string | null;
  };
  readonly verification: Finalized["verification"];
  readonly requirements: readonly RequirementOutcome[];
  readonly regression: string | null;
  readonly execution: string | null;
  readonly attestation: string | null;
  readonly instructions: readonly Pick<LoadedInstruction, "path" | "sha256">[];
  readonly notes: readonly string[];
  readonly resources: {
    readonly steps: number;
    readonly tokens: number;
    readonly estimatedTurns: number;
    readonly verifications: number;
    readonly wallMs: number;
  };
}

const pad = (text: string, width: number) => text.padEnd(width);

/** The terminal's closing summary: the state, each requirement, and where the rest is. */
export function summaryLines(
  report: RunReportFile,
  paths: { readonly markdown: string },
): string[] {
  const lines = [
    `${pad("state", 12)} ${report.state}`,
    `${pad("stop", 12)} ${report.stop}${report.reason === null ? "" : `: ${report.reason}`}`,
  ];
  for (const one of report.requirements) {
    const why = one.limitation === null ? "" : `  ${one.limitation}`;
    lines.push(`${pad(one.id, 12)} ${pad(one.status, 11)}${why}`);
  }
  if (report.regression !== null) lines.push(`${pad("regression", 12)} ${report.regression}`);
  if (report.execution !== null) lines.push(`${pad("execution", 12)} ${report.execution}`);
  lines.push(
    `${pad("patch", 12)} ${report.snapshot.patch} (sha256 ${report.snapshot.patchSha256})`,
  );
  lines.push(`${pad("report", 12)} ${paths.markdown}`);
  return lines;
}

const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

export function renderMarkdown(report: RunReportFile): string {
  return [
    `# swarm run: ${report.state}`,
    "",
    `Task: ${report.task}`,
    "",
    `Model: ${report.model.name} (${report.model.reason}). Stopped: ${report.stop}${report.reason === null ? "" : `, ${report.reason}`}.`,
    "",
    "| Requirement | Kind | Source | Status | Evidence | Limitation |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.requirements.map(
      (one) =>
        `| ${one.id}: ${cell(one.text)} | ${one.kind} | ${one.source} | ${one.status} | ${cell(one.evidence.map((ref) => `${ref.ref} (${ref.outcome}, ${ref.authority})`).join("; ") || "none")} | ${cell(one.limitation ?? "")} |`,
    ),
    "",
    `- Delivered patch: \`${report.snapshot.patch}\`, sha256 ${report.snapshot.patchSha256}, against base ${report.snapshot.base}.`,
    `- Verification of that patch: ${report.verification}.`,
    `- Regression: ${report.regression ?? "not measured"}.`,
    `- Execution: ${report.execution ?? "not measured"}.`,
    `- Attestation: ${report.attestation ?? "none"}.`,
    `- Instructions loaded: ${report.instructions.map((one) => `${one.path} (sha256 ${one.sha256})`).join(", ") || "none"}.`,
    `- Resources: ${report.resources.steps} model turn(s), ${report.resources.tokens} token(s) (${report.resources.estimatedTurns} estimated), ${report.resources.verifications} verification(s) in the loop, ${Math.round(report.resources.wallMs / 1000)} s of wall time.`,
    ...report.notes.map((note) => `- Note: ${note}`),
    "",
  ].join("\n");
}

export async function writeReport(
  directory: string,
  report: RunReportFile,
): Promise<{ readonly json: string; readonly markdown: string }> {
  const json = join(directory, "report.json");
  const markdown = join(directory, "report.md");
  await writeFile(json, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await writeFile(markdown, renderMarkdown(report), { mode: 0o600 });
  return { json, markdown };
}
