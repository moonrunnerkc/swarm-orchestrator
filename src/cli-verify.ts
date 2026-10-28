import { appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildVersion } from "./build-version.ts";
import { UsageError } from "./cli-command-definitions.ts";
import type { ChangeRequest } from "./verify/change.ts";
import { writeAttestation } from "./verify/dsse.ts";
import { git } from "./verify/git.ts";
import { renderMarkdown, renderText, verdictExitCode } from "./verify/report.ts";
import { resolveSigningKey } from "./verify/signing.ts";
import { verifyChange } from "./verify/verify.ts";

const shared = {
  workspace: { type: "string" },
  out: { type: "string" },
  sigstore: { type: "boolean" },
  json: { type: "boolean" },
} as const;

const write = (text: string) => process.stdout.write(`${text}\n`);

async function verifyAndAttest(
  workspace: string,
  request: ChangeRequest,
  values: { out?: string; sigstore?: boolean; json?: boolean; model?: string; prompt?: string },
): Promise<{ readonly code: number; readonly markdown: string }> {
  const outcome = await verifyChange({
    workspace,
    request,
    version: buildVersion,
    producer: {
      ...(values.model === undefined ? {} : { model: values.model }),
      ...(values.prompt === undefined ? {} : { promptSha256: values.prompt }),
    },
  });
  const written = await writeAttestation(
    outcome.statement,
    outcome.patch,
    resolve(values.out ?? join(workspace, ".swarm", "verify")),
    { sigstore: values.sigstore === true, resolveKey: () => resolveSigningKey() },
  );
  const predicate = outcome.statement.predicate;
  if (values.json === true) {
    write(JSON.stringify({ verdict: predicate.verdict, ...written, predicate }));
  } else {
    write(renderText(predicate));
    if (outcome.failureText.length > 0) write(`\n${outcome.failureText}\n`);
    write(`attestation  ${written.bundle}`);
    if (written.publicKey !== null) write(`public key   ${written.publicKey}`);
    if (written.notice !== null) write(`signing      ${written.notice}`);
  }
  return { code: verdictExitCode[predicate.verdict], markdown: renderMarkdown(predicate) };
}

/** `verify`: the working tree, a ref range or a patch file, against a base commit. */
export async function verify(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      ...shared,
      base: { type: "string" },
      patch: { type: "string" },
      range: { type: "string" },
      model: { type: "string" },
      "prompt-sha256": { type: "string" },
    },
  });
  if (values.patch !== undefined && values.range !== undefined) {
    throw new UsageError("verify takes --patch or --range, not both");
  }
  if (values.range !== undefined && values.base !== undefined) {
    throw new UsageError("--range names its own base; drop --base");
  }
  const workspace = resolve(values.workspace ?? process.cwd());
  const base = values.base ?? "HEAD";
  const request: ChangeRequest =
    values.range !== undefined
      ? { kind: "range", range: values.range }
      : values.patch !== undefined
        ? { kind: "patch", path: resolve(values.patch), base }
        : { kind: "working-tree", base };
  const prompt = values["prompt-sha256"];
  return (
    await verifyAndAttest(workspace, request, {
      ...values,
      ...(prompt === undefined ? {} : { prompt }),
    })
  ).code;
}

/**
 * `ci`: the change on HEAD since it left the base branch, with a Markdown summary where the CI
 * system reads one. The base is --base, else the pull request's base branch.
 */
export async function ci(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: { ...shared, base: { type: "string" } },
  });
  const workspace = resolve(values.workspace ?? process.cwd());
  const baseRef =
    values.base ??
    (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined);
  if (baseRef === undefined) {
    throw new UsageError("ci needs --base <ref> outside a pull request");
  }
  const mergeBase = (await git(workspace, ["merge-base", baseRef, "HEAD"])).toString().trim();
  const { code, markdown } = await verifyAndAttest(
    workspace,
    { kind: "range", range: `${mergeBase}..HEAD` },
    values,
  );
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) await appendFile(summary, markdown);
  return code;
}
