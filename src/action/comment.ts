import { challengeLines } from "../evidence/challenge-lines.ts";
import { reviewerText } from "../evidence/ci-summary.ts";
import type { Verdict } from "./verdict.ts";

/**
 * The pull request comment: one per pull request, updated in place, bound to the head it
 * describes. Everything a candidate could have written (check names, findings, paths) arrives
 * through the reviewer text escape, which also neutralises mentions, so a candidate cannot
 * page a maintainer or link out of the comment. The whole body is bounded below GitHub's limit.
 */
export const commentMarker = "<!-- swarm-verify -->";

/** GitHub refuses a comment body over 65536 characters; stay well under with a named cut. */
const bodyLimit = 60_000;

export interface AttestationState {
  readonly status: "signed" | "unavailable" | "skipped";
  readonly url: string | null;
  readonly detail: string;
}

function marker(pullRequest: number, head: string): string {
  return `${commentMarker}\n<!-- swarm-verify pr=${pullRequest} head=${head} -->`;
}

/** Text a candidate could have shaped, escaped and with mentions defused. */
function untrusted(value: string): string {
  return reviewerText(value).replaceAll("@", "&#64;");
}

function resultLine(verdict: Verdict): string {
  switch (verdict.decision.result) {
    case "verified":
      return "**Verified**: the recorded checks passed and every declared requirement was accepted.";
    case "regression-only":
      return "**Regression-only pass**: nothing this patch changed broke a check; a failure the base already had, if any, is named below as inherited. No requirement contract was supplied, so whether the work does what was asked is unmeasured.";
    case "not-verified":
      return "**Not verified**: a check failed or a requirement was rejected.";
    case "incomplete":
      return "**Incomplete**: the assessment could not measure what it needed to.";
    case "head-changed":
      return "**Not current**: the pull request moved before this run finished; this result describes an earlier head.";
    case "refused":
      return "**Refused**: the source could not be verified as identified.";
  }
}

/** Render the comment body from the signed verdict and the assessment summary. */
export function renderComment(options: {
  readonly verdict: Verdict;
  readonly summary: string | null;
  readonly attestation: AttestationState;
  readonly runUrl: string;
  readonly artifactName: string;
}): string {
  const { verdict } = options;
  const scope =
    verdict.decision.task === "accepted" || verdict.decision.task === "rejected"
      ? "requirement checks from a trusted contract were run"
      : "no requirement contract was supplied, so task correctness is unmeasured";
  const lines = [
    marker(verdict.pullRequest ?? 0, verdict.eventHead ?? verdict.head),
    "## swarm-verify",
    "",
    resultLine(verdict),
    "",
    `Source: ${verdict.target === "merge" ? "test merge" : "head"} \`${verdict.head}\` against base \`${verdict.base}\`` +
      `${verdict.tree === null ? "" : `, tree \`${verdict.tree}\``}.`,
    `Regression: ${verdict.decision.regression ?? "not run"}. Task: ${verdict.decision.task ?? "unjudged"} (${scope}).`,
    `Execution: ${untrusted(verdict.execution.executionTrust)} under ${verdict.policy.isolation}${verdict.policy.image === null ? "" : ` \`${untrusted(verdict.policy.image)}\``}.`,
    verdict.decision.unmeasured.length === 0
      ? "Unmeasured: nothing the policy asked for."
      : `Unmeasured: ${verdict.decision.unmeasured.map(untrusted).join(", ")}.`,
    verdict.decision.reason === null ? "" : `Reason: ${untrusted(verdict.decision.reason)}.`,
    ...(verdict.decision.challenges === null
      ? []
      : challengeLines(verdict.decision.challenges).map((line, index) =>
          index === 0
            ? `${untrusted(line.charAt(0).toUpperCase() + line.slice(1))}.`
            : `- ${untrusted(line)}`,
        )),
    "",
    `Signature: ${
      options.attestation.status === "signed"
        ? `signed by this workflow ([attestation](${options.attestation.url ?? options.runUrl})); verify with \`gh attestation verify verdict.json --repo ${verdict.repository} --predicate-type https://github.com/moonrunnerkc/swarm-verify/verdict/v1\``
        : options.attestation.status === "skipped"
          ? `not requested (${untrusted(options.attestation.detail)})`
          : `unavailable: ${untrusted(options.attestation.detail)}`
    }.`,
    `Evidence: artifact \`${options.artifactName}\` on [this run](${options.runUrl}) holds the JSON report, the signed bundle with its own verifier, and the verdict document (${verdict.evidence.reportDigest ?? "no report"}).`,
    `Verifier: swarm-verify ${untrusted(verdict.verifier.version)}, run ${verdict.execution.runId} attempt ${verdict.execution.runAttempt}.`,
    "",
    "<details><summary>Assessment</summary>",
    "",
    options.summary === null
      ? "_No assessment summary was produced._"
      : options.summary.replaceAll("@", "&#64;"),
    "",
    "</details>",
    "",
    "_A regression pass says nothing broke. Only a requirement contract can say the work was done._",
  ].filter((line) => line !== null);
  const body = lines.join("\n");
  return body.length <= bodyLimit
    ? body
    : `${body.slice(0, bodyLimit - 80)}\n\n_Comment truncated; the full assessment is in the run artifact._`;
}

export type CommentOutcome =
  | { readonly status: "created" | "updated"; readonly url: string }
  | { readonly status: "stale-head"; readonly currentHead: string }
  | { readonly status: "unavailable"; readonly reason: string };

type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ status: number; json(): Promise<unknown>; text(): Promise<string> }>;

/**
 * Create or update the one comment, only while the pull request still points at the head the
 * verdict describes. A delayed run for an older head finds a newer head and posts nothing.
 */
export async function publishComment(options: {
  readonly apiUrl: string;
  readonly token: string | null;
  readonly repository: string;
  readonly pullRequest: number;
  readonly head: string;
  readonly body: string;
  readonly fetch?: Fetch;
}): Promise<CommentOutcome> {
  if (options.token === null)
    return { status: "unavailable", reason: "no token was supplied to publish with" };
  const doFetch: Fetch = options.fetch ?? (globalThis.fetch as unknown as Fetch);
  const headers = {
    Authorization: `Bearer ${options.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "swarm-verify",
  };
  const base = `${options.apiUrl}/repos/${options.repository}`;
  const read = async (url: string) => {
    const response = await doFetch(url, { method: "GET", headers });
    if (response.status !== 200)
      throw new Error(`GET ${url.replace(options.apiUrl, "")} answered ${response.status}`);
    return response.json();
  };
  try {
    const pull = (await read(`${base}/pulls/${options.pullRequest}`)) as {
      head?: { sha?: string };
    };
    const currentHead = pull.head?.sha ?? "";
    if (currentHead !== options.head) return { status: "stale-head", currentHead };
    let existing: { id: number; html_url: string } | null = null;
    for (let page = 1; page <= 10 && existing === null; page += 1) {
      const comments = (await read(
        `${base}/issues/${options.pullRequest}/comments?per_page=100&page=${page}`,
      )) as { id: number; body?: string; html_url: string }[];
      existing = comments.find((one) => (one.body ?? "").startsWith(commentMarker)) ?? null;
      if (comments.length < 100) break;
    }
    const response = await doFetch(
      existing === null
        ? `${base}/issues/${options.pullRequest}/comments`
        : `${base}/issues/comments/${existing.id}`,
      {
        method: existing === null ? "POST" : "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ body: options.body }),
      },
    );
    if (response.status !== 200 && response.status !== 201)
      return {
        status: "unavailable",
        reason: `${existing === null ? "POST" : "PATCH"} answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
      };
    const written = (await response.json()) as { html_url?: string };
    return { status: existing === null ? "created" : "updated", url: written.html_url ?? "" };
  } catch (cause) {
    return {
      status: "unavailable",
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
