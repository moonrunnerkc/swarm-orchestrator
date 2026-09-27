import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import { canonicalVerdict, verdictPredicateType, verdictSchema } from "./action/verdict.ts";
import type { VerdictCommand } from "./cli-verify-options.ts";
import { exitCodes } from "./machine-output.ts";

const run = promisify(execFile);

/**
 * Check a signed verdict from outside the run that produced it. Two questions, answered apart
 * as `verify` answers them for a bundle: is the document consistent with the evidence beside
 * it (the report, the summary and the bundle it names by digest), and was it signed by the
 * workflow the reader expects. The second is answered by GitHub's own attestation verifier
 * against Sigstore's public trust root, which this command runs and never reimplements; where
 * `gh` is not installed the exact command is printed and the signer stays unverified. Nothing
 * here says the decision is right: that is what the bundle's own verifier re-derives.
 */
function digestOf(bytes: string | Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function onPath(program: string): Promise<boolean> {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory.length > 0 && (await exists(join(directory, program)))) return true;
  }
  return false;
}

export async function verifyVerdict(options: VerdictCommand): Promise<number> {
  const out = (line: string) => process.stdout.write(`${line}\n`);
  let raw: string;
  try {
    raw = await readFile(options.verdictPath, "utf8");
  } catch {
    out(`verdict:    unverified (no readable document at ${options.verdictPath})`);
    return exitCodes.invalidRequest;
  }
  let parsed: ReturnType<typeof verdictSchema.parse>;
  try {
    parsed = verdictSchema.parse(JSON.parse(raw));
  } catch (cause) {
    out(
      `verdict:    unverified (the document is not a swarm-verify.verdict.v1: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)})`,
    );
    return exitCodes.invalidRequest;
  }
  const canonical = canonicalVerdict(parsed);
  const fileDigest = digestOf(raw);
  const canonicalDigest = canonical.digest;
  out(
    `document:   ${parsed.schema} for ${parsed.repository}${parsed.pullRequest === null ? "" : `#${parsed.pullRequest}`}, ${parsed.target} ${parsed.head} against ${parsed.base}`,
  );
  out(
    `decision:   ${parsed.decision.result} (action status ${parsed.decision.status}, verifier status ${parsed.decision.verifierStatus ?? "none"}); regression ${parsed.decision.regression ?? "not run"}, task ${parsed.decision.task ?? "unjudged"}`,
  );
  out(
    `digest:     ${fileDigest}${fileDigest === canonicalDigest ? " (canonical)" : ` (file bytes differ from the canonical rendering ${canonicalDigest})`}`,
  );

  const evidence = options.evidenceDirectory ?? dirname(options.verdictPath);
  const problems: string[] = [];
  const bound: string[] = [];
  const compare = async (name: string, expected: string | null, path: string) => {
    if (expected === null) return;
    if (!(await exists(path))) {
      problems.push(`${name} named by digest but absent at ${path}`);
      return;
    }
    const actual = digestOf(await readFile(path));
    if (actual === expected) bound.push(name);
    else problems.push(`${name} at ${path} digests to ${actual}, the verdict names ${expected}`);
  };
  await compare("report.json", parsed.evidence.reportDigest, join(evidence, "report.json"));
  await compare("summary.md", parsed.evidence.summaryDigest, join(evidence, "summary.md"));
  if (parsed.evidence.bundleChainHead !== null) {
    const manifest = join(evidence, "bundle", "manifest.json");
    if (!(await exists(manifest)))
      problems.push(`bundle named by chain head but absent at ${manifest}`);
    else {
      try {
        const head = (JSON.parse(await readFile(manifest, "utf8")) as { chainHead?: string })
          .chainHead;
        if (head === parsed.evidence.bundleChainHead) bound.push("bundle chain head");
        else
          problems.push(
            `bundle chain head is ${head}, the verdict names ${parsed.evidence.bundleChainHead}`,
          );
      } catch {
        problems.push("bundle manifest is unreadable");
      }
    }
  }
  if (fileDigest !== canonicalDigest)
    problems.push("the document is not in its canonical rendering");
  out(
    problems.length === 0
      ? `evidence:   bound (${bound.length === 0 ? "the verdict names no evidence" : bound.join(", ")})`
      : `evidence:   inconsistent\n            ${problems.join("\n            ")}`,
  );

  const command = [
    "gh",
    "attestation",
    "verify",
    options.verdictPath,
    "--repo",
    options.repository ?? "OWNER/REPO",
    "--predicate-type",
    verdictPredicateType,
    ...(options.signerWorkflow === null ? [] : ["--signer-workflow", options.signerWorkflow]),
  ];
  const attestation = join(evidence, "attestation", "verdict.sigstore.json");
  if (await exists(attestation)) command.push("--bundle", attestation);
  let signer: "trusted" | "untrusted" | "unverified" = "unverified";
  if (options.repository === null) {
    out(
      "signer:     unverified. Name the repository you expect with --repo, and the workflow with --signer-workflow, to check who signed it",
    );
  } else if (!(await onPath("gh"))) {
    out(
      `signer:     unverified. GitHub's attestation verifier is not on PATH; run:\n            ${command.join(" ")}`,
    );
  } else {
    try {
      const verified = await run(command[0] as string, command.slice(1), { maxBuffer: 4_000_000 });
      signer = "trusted";
      out(`signer:     trusted (${command.join(" ")})`);
      const detail = verified.stdout.trim().split("\n").slice(-6).join("\n            ");
      if (detail.length > 0) out(`            ${detail}`);
    } catch (cause) {
      signer = "untrusted";
      const failed = cause as { stdout?: string; stderr?: string };
      out(
        `signer:     untrusted (${command.join(" ")})\n            ${`${failed.stderr ?? ""}${failed.stdout ?? ""}`.trim().split("\n").slice(-4).join("\n            ")}`,
      );
    }
  }
  if (problems.length > 0 || signer === "untrusted") return exitCodes.notAcceptable;
  return signer === "trusted" ? exitCodes.acceptable : exitCodes.notAcceptable;
}
