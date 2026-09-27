import { appendFileSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { retainActionArtifacts } from "./action/artifacts.ts";
import { type AttestationState, publishComment, renderComment } from "./action/comment.ts";
import { readActionContext } from "./action/environment.ts";
import { verdictSchema } from "./action/verdict.ts";
import { publishOutputs, runActionVerify } from "./action/verify.ts";
import type { ActionCommand } from "./cli-verify-options.ts";
import { exitCodes } from "./machine-output.ts";

/**
 * The three steps the GitHub Action is made of, as subcommands of the same binary the Action
 * installs, so the Action is a thin client of the engine and carries no engine of its own.
 * Each step reads the runner's environment and writes the runner's outputs; none of them
 * decides anything the verifier did not.
 */
function output(name: string, value: string): void {
  const path = process.env.GITHUB_OUTPUT;
  if (path !== undefined && path.length > 0) appendFileSync(path, `${name}=${value}\n`);
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is not set`);
  return value;
}

async function verify(): Promise<number> {
  const context = await readActionContext();
  const outputs = runActionVerify(context);
  publishOutputs(context, outputs);
  process.stdout.write(
    `swarm-verify action: ${outputs.result} (verifier exit ${outputs.status}) for ${outputs.head}\n`,
  );
  // The step itself succeeds whenever it produced a verdict; the verifier's own status is an
  // output the final step of the Action returns, after evidence is retained and published.
  return exitCodes.acceptable;
}

async function comment(): Promise<number> {
  const context = await readActionContext();
  const evidence = required("SWARM_EVIDENCE");
  const verdict = verdictSchema.parse(
    JSON.parse(readFileSync(join(evidence, "verdict.json"), "utf8")),
  );
  let summary: string | null = null;
  try {
    summary = readFileSync(join(evidence, "summary.md"), "utf8");
  } catch {
    summary = null;
  }
  const attestationOutcome = process.env.SWARM_ATTESTATION_OUTCOME ?? "skipped";
  const bundlePath = process.env.SWARM_ATTESTATION_BUNDLE ?? "";
  let attestation: AttestationState;
  if (attestationOutcome === "success" && bundlePath.length > 0) {
    mkdirSync(join(evidence, "attestation"), { recursive: true, mode: 0o700 });
    copyFileSync(bundlePath, join(evidence, "attestation", "verdict.sigstore.json"));
    attestation = {
      status: "signed",
      url: process.env.SWARM_ATTESTATION_URL ?? null,
      detail: "signed",
    };
  } else if (attestationOutcome === "skipped") {
    attestation = {
      status: "skipped",
      url: null,
      detail: process.env.SWARM_ATTESTATION_REASON ?? "attestation was not requested",
    };
  } else {
    attestation = {
      status: "unavailable",
      url: null,
      detail:
        process.env.SWARM_ATTESTATION_REASON ??
        "the attest step failed; on a fork pull request the id-token permission is not granted, so use the trusted workflow route",
    };
  }
  output("attestation", attestation.status);
  const runUrl = `${context.serverUrl}/${context.repository}/actions/runs/${context.runId}/attempts/${context.runAttempt}`;
  const body = renderComment({
    verdict,
    summary,
    attestation,
    runUrl,
    artifactName: required("SWARM_ARTIFACT"),
  });
  if (context.pullRequest === null || !context.inputs.comment) {
    output("comment", "skipped");
    process.stdout.write(
      "swarm-verify action: no pull request comment (none requested or no pull request)\n",
    );
    return exitCodes.acceptable;
  }
  const published = await publishComment({
    apiUrl: context.apiUrl,
    token: context.inputs.token,
    repository: context.repository,
    pullRequest: context.pullRequest.number,
    head: verdict.eventHead ?? verdict.head,
    body,
  });
  output("comment", published.status);
  if (published.status === "created" || published.status === "updated")
    output("comment-url", published.url);
  process.stdout.write(
    `swarm-verify action: comment ${published.status}${"reason" in published ? `: ${published.reason}` : ""}${"currentHead" in published ? ` (current head ${published.currentHead})` : ""}\n`,
  );
  return exitCodes.acceptable;
}

function retain(): number {
  const evidence = required("SWARM_EVIDENCE");
  const retention = retainActionArtifacts(evidence);
  output("retained", retention.destination);
  output("retention", retention.complete ? "complete" : "incomplete");
  process.stdout.write(
    `swarm-verify action: retention ${retention.complete ? "complete" : "incomplete"} at ${retention.destination}\n`,
  );
  return exitCodes.acceptable;
}

/** Dispatch one Action step. */
export async function action(options: ActionCommand): Promise<number> {
  if (options.step === "verify") return verify();
  if (options.step === "comment") return comment();
  return retain();
}
