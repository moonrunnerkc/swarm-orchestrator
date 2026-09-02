import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { JsonValue } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { type BondDefinition, type BondVerdict, bondFor, bondVerdict } from "./bonds.ts";
import type { GateContext, GateDefinition } from "./gate-definition.ts";
import { type GateCycle, type GateCycleDependencies, observe } from "./gate-runner.ts";
import { measureNames } from "./parsers.ts";
import type { ProjectType } from "./project-type.ts";

const maxRecordedOutputChars = 64_000;

/**
 * The record a bond leaves. It carries the observation the check made over the bonded tree
 * for the same reason a gate-run does: a reader holding the record can apply the parser's
 * rule to these bytes and arrive at the same verdict, and the embedded verifier does.
 */
export const gateBondSchema = z.object({
  gateId: z.string().min(1),
  title: z.string(),
  severity: z.enum(["blocking", "advisory"]),
  /** What the bond changed, or null where no bond is defined for this gate. */
  bond: z
    .object({
      description: z.string(),
      files: z.array(z.string()),
      provable: z.boolean(),
    })
    .nullable(),
  expected: z.literal("failed"),
  observed: z.enum(["passed", "failed", "not-applicable"]).nullable(),
  verdict: z.enum(["held", "vacuous", "unshown", "not-measured", "not-bonded"]),
  detail: z.string(),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  measures: z.record(z.string(), z.number()),
  /** The tests the final cycle collected, so a reader can see whether the bond was collected. */
  collectedBefore: z.number().nullable(),
});

export type GateBondPayload = z.infer<typeof gateBondSchema>;

export interface BondOutcome {
  readonly gateId: string;
  readonly severity: "blocking" | "advisory";
  readonly verdict: BondVerdict | "not-bonded";
  readonly detail: string;
  readonly record: string;
}

export interface BondRunInput {
  readonly gates: readonly GateDefinition[];
  readonly finalCycle: GateCycle;
  /** Rebuilt for every bond, so the change set the inspections read includes the bond file. */
  readonly context: () => Promise<GateContext>;
  readonly deps: GateCycleDependencies;
  readonly evidence: EvidenceRecorder;
  readonly workspaceRoot: string;
  readonly detectedTypes: readonly ProjectType[];
}

/**
 * One bond per gate that passed in the final cycle, each written, observed and removed
 * before the next, so no bond's file is in the tree while another check runs. A gate that
 * did not pass is not bonded: the question is whether a pass can fail, and a failure has
 * already answered it. Every bond leaves a record whatever it showed, including the gates
 * that have no bond, so a reader can tell "held" from "never asked".
 */
export async function runBonds(input: BondRunInput): Promise<readonly BondOutcome[]> {
  const outcomes: BondOutcome[] = [];
  const collectedBefore = input.finalCycle.measures[measureNames.testsCollected] ?? null;

  for (const gate of input.gates) {
    if (input.finalCycle.statuses[gate.id] !== "passed") {
      continue;
    }
    const bond = bondFor({
      gateId: gate.id,
      detectedTypes: input.detectedTypes,
      maxAddedLines: (await input.context()).budgets.maxAddedLines,
    });
    if (bond === null) {
      outcomes.push(
        await record(
          input,
          gate,
          null,
          collectedBefore,
          null,
          "not-bonded",
          "no bond is defined for this gate, so its pass has not been shown capable of failing",
        ),
      );
      continue;
    }

    const placed = await placeBond(input.workspaceRoot, bond);
    if (!placed.ok) {
      outcomes.push(
        await record(input, gate, bond, collectedBefore, null, "not-bonded", placed.reason),
      );
      continue;
    }

    try {
      const { observation } = await observe(gate, await input.context(), input.deps);
      const reading = gate.parse(observation);
      const verdict = bondVerdict({
        observed: reading.status,
        provable: bond.provable,
        collectedBefore,
        collectedAfter: reading.measures[measureNames.testsCollected] ?? null,
      });
      outcomes.push(
        await record(
          input,
          gate,
          bond,
          collectedBefore,
          { observation, reading },
          verdict,
          describeVerdict(verdict, gate.id, reading.detail),
        ),
      );
    } finally {
      await removeBond(input.workspaceRoot, bond);
    }
  }
  return outcomes;
}

function describeVerdict(verdict: BondVerdict, gateId: string, detail: string): string {
  switch (verdict) {
    case "held":
      return `the ${gateId} gate refused the bond: ${detail}`;
    case "vacuous":
      return `the ${gateId} gate passed over a bond it was handed, so this pass cannot fail: ${detail}`;
    case "unshown":
      return `the ${gateId} gate passed with the bond in place, and nothing shows whether it read the bond: ${detail}`;
    case "not-measured":
      return `the ${gateId} gate could not run over the bond: ${detail}`;
  }
}

async function placeBond(
  workspaceRoot: string,
  bond: BondDefinition,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  for (const file of bond.files) {
    const target = join(workspaceRoot, file.path);
    let exists = true;
    try {
      await readFile(target);
    } catch {
      exists = false;
    }
    if (exists) {
      return {
        ok: false,
        reason: `${file.path} already exists in the workspace, and a bond never overwrites a file`,
      };
    }
  }
  for (const file of bond.files) {
    const target = join(workspaceRoot, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
  }
  return { ok: true };
}

async function removeBond(workspaceRoot: string, bond: BondDefinition): Promise<void> {
  for (const file of bond.files) {
    await rm(join(workspaceRoot, file.path), { force: true });
    const parent = dirname(file.path);
    if (parent !== ".") {
      // A directory the bond created is removed with it; one the project had stays, because
      // rm refuses a directory that still has the project's files in it.
      await rm(join(workspaceRoot, parent), { recursive: false, force: true }).catch(() => {});
    }
  }
}

function truncate(text: string): string {
  return text.length <= maxRecordedOutputChars
    ? text
    : `${text.slice(0, maxRecordedOutputChars)}\n[truncated at ${maxRecordedOutputChars} characters]`;
}

async function record(
  input: BondRunInput,
  gate: GateDefinition,
  bond: BondDefinition | null,
  collectedBefore: number | null,
  observed: {
    observation: { exitCode: number; stdout: string; stderr: string };
    reading: {
      status: "passed" | "failed" | "not-applicable";
      measures: Readonly<Record<string, number>>;
    };
  } | null,
  verdict: BondVerdict | "not-bonded",
  detail: string,
): Promise<BondOutcome> {
  const payload = gateBondSchema.parse({
    gateId: gate.id,
    title: gate.title,
    severity: gate.severity,
    bond:
      bond === null
        ? null
        : {
            description: bond.description,
            files: bond.files.map((file) => file.path),
            provable: bond.provable,
          },
    expected: "failed",
    observed: observed?.reading.status ?? null,
    verdict,
    detail,
    exitCode: observed?.observation.exitCode ?? null,
    stdout: truncate(observed?.observation.stdout ?? ""),
    stderr: truncate(observed?.observation.stderr ?? ""),
    measures: observed?.reading.measures ?? {},
    collectedBefore,
  });
  const recorded = await input.evidence.record({
    type: "gate-bond",
    actor: "harness",
    provenance: ["tool-output"],
    payload: payload as unknown as JsonValue,
  });
  return {
    gateId: gate.id,
    severity: gate.severity,
    verdict,
    detail,
    record: recorded.record.payloadDigest,
  };
}
