import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type BehaviorCheckInput,
  type ExecutionPolicy,
  httpSurface,
  type Requirement,
  type SecurityFile,
  securityChecks,
  securityRequirement,
  tryBinding,
} from "swarm-verify";
import { gitText } from "swarm-verify/execution";
import {
  conventionParts,
  conventionRequirement,
  runConventions,
} from "../conventions/run-conventions.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { baseFacts, runtimeFacts } from "./base-facts.ts";
import { type RequirementRecord, withDerived } from "./requirement-record.ts";
import type { RunOptions } from "./run-options.ts";
import { readSecurityFile, securityApplicability } from "./security.ts";
import { draftSecurity } from "./security-author.ts";

/**
 * What a run derives beside the user's requirements, settled before the first edit: the approved
 * conventions as they stand now, and the security obligations the task brings with it. Each
 * becomes a requirement under its own source, with a check the coding model did not write.
 */
export async function deriveForRun(input: {
  readonly home: string;
  readonly repository: string;
  readonly workspace: string;
  readonly options: RunOptions;
  readonly evidence: EvidenceRecorder;
}) {
  const { options, workspace } = input;
  const conventions = await runConventions(input.home, input.repository, options.task);
  const rules = conventions?.rules ?? {};
  const checked = Object.keys(rules).length > 0;
  const surface = await httpSurface(workspace);
  const applicability = securityApplicability({
    task: options.task,
    api: surface.found,
    forced: options.security?.apply ?? [],
    excluded: options.security?.exclude ?? [],
  });
  const unknown = applicability.find((one) => one.applies === "unknown");
  const applies = applicability.filter((one) => one.applies === "yes").map((one) => one.class);
  const notes = [
    ...(conventions?.notes ?? []),
    ...(conventions === null
      ? []
      : [
          `Conventions: the approved profile ${conventions.profile.version}, sha256 ${conventions.profile.sha256}, as it stood when the run started.`,
        ]),
    ...applicability.map(
      (one) =>
        `Security: ${one.class} ${one.applies === "yes" ? "applies" : one.applies === "no" ? "does not apply" : "could not be settled"}: ${one.reason}.`,
    ),
  ];
  let behavior: BehaviorCheckInput[] = [];
  let tokens = 0;
  let held: string | null = null;
  /**
   * What becomes of a draft nobody has read: used as drafted only where the user said so
   * (`--accept-authored`), shown for approval at a terminal, else written out and the run stopped.
   */
  const settleDraft = async (
    draft: SecurityFile,
    tryAtBase: (file: SecurityFile) => Promise<string | null>,
  ): Promise<SecurityFile | null> => {
    const mode = options.checksMode ?? { kind: "accept-authored" as const };
    const directory = mode.kind === "write" ? mode.directory : input.evidence.directory;
    const path = join(directory, "security.json");
    await mkdir(directory, { recursive: true });
    await writeFile(path, `${JSON.stringify(draft, null, 2)}\n`);
    const drafted = `the security checks' binding was drafted by a model call that read the base and never the change: ${path}`;
    if (mode.kind === "accept-authored") {
      notes.push(
        `Security: ${drafted}. It is used as drafted because --accept-authored was passed; nobody reviewed it. To stand behind it, read it and pass it with --security-check.`,
      );
      return draft;
    }
    if (mode.kind === "write") {
      held = `${drafted}. Read it, correct it if need be, then run again with --security-check ${path}`;
      return null;
    }
    let problem: string | null = null;
    while (true) {
      const content = await readFile(path, "utf8");
      const answer = await mode.reviewer({
        requirement: "the security checks (the binding: which requests, as which users)",
        path: "security.json",
        file: path,
        content,
        problem,
      });
      if (answer === "reject") break;
      try {
        const reviewed = await readSecurityFile(path);
        problem = await tryAtBase(reviewed);
        if (problem === null) return reviewed;
      } catch (error) {
        problem = (error as Error).message;
      }
    }
    notes.push(
      `Security: the drafted binding was rejected, so ${applies.join(", ")} stays unverified.`,
    );
    return null;
  };
  return {
    block: conventions?.block ?? "",
    profile: conventions?.profile,
    applicability,
    notes: () => notes,
    tokens: () => tokens,
    behavior: () => behavior,
    /** Why the run stops before anything is built: an obligation whose bearing is not known. */
    blocked:
      unknown === undefined
        ? null
        : `whether the ${unknown.class} obligation applies could not be settled: ${unknown.reason}. Say which: --security ${unknown.class} or --no-security ${unknown.class}`,
    /** The conventions on the tree between turns, for the requirement that holds them. */
    turnChecks: (base: string) => async (one: Requirement) =>
      one.source === "profile" ? conventionParts(workspace, base, rules) : [],
    /** Why the run stops once the record is fixed: a binding to read first, or one that failed. */
    held: () => held,
    /**
     * The record with the derived requirements added, and the security checks made for them. A
     * binding, the user's or a draft, is tried at the base with real requests before it is used.
     */
    async fix(
      record: RequirementRecord,
      at: { readonly base: string; readonly execution: ExecutionPolicy },
    ): Promise<RequirementRecord> {
      let file: SecurityFile | null = null;
      let authority: BehaviorCheckInput["authority"] = "user-acceptance";
      const tryAtBase = async (tried: SecurityFile): Promise<string | null> => {
        const found = await tryBinding(tried, {
          workspace,
          baseCommit: at.base,
          policy: at.execution,
          signal: options.signal,
        });
        atBase.splice(0, atBase.length, ...found.observed);
        return found.problem;
      };
      const atBase: string[] = [];
      const supplied = options.security?.file ?? null;
      if (applies.length > 0 && supplied !== null) {
        file = await readSecurityFile(supplied);
        const problem = await tryAtBase(file);
        if (problem !== null) held = `the security binding ${supplied} cannot be used: ${problem}`;
        const bound = file.checks.map((one) => one.class);
        for (const name of applies.filter((one) => !bound.includes(one)))
          notes.push(
            `Security: ${supplied} holds no check of class ${name}, so that obligation stays unverified. Add one to the file.`,
          );
      } else if (applies.length > 0) {
        const tracked = (await gitText(workspace, ["ls-files"])).split("\n");
        const runtime = await runtimeFacts(workspace, tracked, { path: "", content: "" });
        const drafted = await draftSecurity({
          model: options.model,
          evidence: input.evidence,
          task: options.task,
          classes: applies,
          runtime: runtime.notes,
          shown: await baseFacts(workspace, tracked, [...surface.files, ...runtime.entries]),
          tryAtBase,
          turnTokens: options.turnTokens,
          signal: options.signal,
        });
        tokens = drafted.tokens;
        file = drafted.file;
        if (file === null)
          notes.push(
            `Security: no usable check could be drafted (${drafted.failure}), so ${applies.join(", ")} stays unverified. Supply the binding with --security-check <file>.`,
          );
        else file = await settleDraft(file, tryAtBase);
        authority = options.checksMode?.kind === "review" ? authority : "independently-generated";
      }
      if (file !== null)
        notes.push(
          `Security: the binding, sha256 ${createHash("sha256").update(JSON.stringify(file)).digest("hex")}, was tried at the base with real requests before the first edit (${atBase.join(" | ")}).`,
        );
      const ids = new Map<(typeof applies)[number], string>();
      const fixed = withDerived(record, [
        ...(checked ? [(id: string) => conventionRequirement(id, rules)] : []),
        ...applies.map((name) => (id: string) => {
          ids.set(name, id);
          const binding = file?.checks.find((one) => one.class === name) ?? null;
          return securityRequirement(id, name, binding);
        }),
      ]);
      behavior = file === null ? [] : securityChecks(file, authority, ids);
      return fixed;
    },
  };
}
