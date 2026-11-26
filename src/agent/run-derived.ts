import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type BehaviorCheckInput,
  httpSurface,
  type Requirement,
  type SecurityFile,
  securityChecks,
  securityRequirement,
} from "swarm-verify";
import {
  conventionParts,
  conventionRequirement,
  runConventions,
} from "../conventions/run-conventions.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
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
    /** The record with the derived requirements added, and the security checks made for them. */
    async fix(record: RequirementRecord): Promise<RequirementRecord> {
      let file: SecurityFile | null = null;
      let authority: BehaviorCheckInput["authority"] = "user-acceptance";
      if (applies.length > 0 && options.security?.file != null) {
        file = await readSecurityFile(options.security.file);
      } else if (applies.length > 0) {
        const drafted = await draftSecurity({
          ...input,
          model: options.model,
          task: options.task,
          classes: applies,
          files: surface.files,
          turnTokens: options.turnTokens,
          signal: options.signal,
        });
        tokens = drafted.inputTokens + drafted.outputTokens;
        file = drafted.file;
        authority = "independently-generated";
        if (file === null)
          notes.push(
            `Security: no check could be drafted (${drafted.failure}), so ${applies.join(", ")} stays unverified. Supply the binding with --security-check <file>.`,
          );
        else {
          const mode = options.checksMode;
          const directory = mode?.kind === "write" ? mode.directory : input.evidence.directory;
          await mkdir(directory, { recursive: true });
          await writeFile(join(directory, "security.json"), `${JSON.stringify(file, null, 2)}\n`);
          notes.push(
            `Security: the checks' binding was drafted by a model call that read the base and never the change, and nobody reviewed it: ${join(directory, "security.json")}. Read it, then pass it with --security-check to stand behind it.`,
          );
        }
      }
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
