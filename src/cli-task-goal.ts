import { z } from "zod";
import { acceptanceGateId, diagnosticsGateId } from "./cli-run-outcome.ts";
import type { Clock } from "./core/clock.ts";
import type { GateStatus } from "./core/loop-events.ts";
import { asJsonValue, digestOfBytes } from "./evidence/canonical-json.ts";
import {
  diagnosticChecks,
  freezeGoalContract,
  type GoalContract,
} from "./evidence/goal-contract.ts";
import { recordGoalAssessment } from "./evidence/run-assessment.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import { harnessChildEnvironment } from "./exec/child-environment.ts";
import type { ContainerBackendOptions } from "./exec/container-backend.ts";
import { recordedContainerBackend } from "./exec/runtime-resource.ts";
import { runBehaviorCheck } from "./gates/behavior-check.ts";
import type { GateSetOptions } from "./gates/default-gates.ts";
import type { GateDefinition, GateOverride } from "./gates/gate-definition.ts";
import type { ChallengePolicy } from "./gates/goal-challenges.ts";
import {
  type IndependentVerification,
  refusedVerification,
  verifyIndependently,
} from "./gates/independent-verification.ts";
import { createNodeCommandRunner } from "./gates/node-command-runner.ts";
import { inspectionParser } from "./gates/parsers.ts";
import { diffAgainstBase, patchAgainstBase } from "./gates/scratch-index.ts";
import { VerificationRefusalError } from "./gates/verification-refusal.ts";
import { pathsInlineCodeCouldOpen } from "./tools/shell-command.ts";
import { defineTool, type ToolDefinition } from "./tools/tool-definition.ts";
import {
  describeRelationRun,
  inputAsRead,
  type PlannedRelation,
  plannedCheckRunner,
  plannedInputs,
  plannedRelation,
  programDidNotLoad,
  relationCalls,
} from "./workers/planned-check-program.ts";

export interface TaskGoalContext {
  readonly contract: GoalContract;
  readonly workspace: string;
  readonly baseCommit: string;
  readonly evidence: EvidenceRecorder;
  readonly clock: Clock;
  readonly signal: AbortSignal;
  readonly isolation: ContainerBackendOptions | null;
  readonly install: boolean;
  /** The lockfile setup installs from where the checkout holds several. */
  readonly lockfile?: string;
  /**
   * The gate commands the run was configured with (swarm.toml `[gates]`), so the fresh checkout
   * judges the candidate by the gates the run sealed. Without them the verifier assembled its
   * own gates from the checkout's manifest, and a run whose sealed `tests` gate was the
   * project's node suite was refused on the browser suite its manifest's `test` script runs:
   * the checkout had no swarm.toml, the workspace's being untracked, and nothing else carried
   * the override across.
   */
  readonly commandOverrides?: Readonly<Record<string, GateOverride>>;
  /** How the requirement checks are challenged; absent is off. */
  readonly challengePolicy?: ChallengePolicy;
}

/** The gate options the verification shares with the run: its lockfile and its command overrides. */
function verificationGateOptions(context: TaskGoalContext): GateSetOptions | undefined {
  const options: GateSetOptions = {
    ...(context.lockfile === undefined ? {} : { lockfile: context.lockfile }),
    ...(context.commandOverrides === undefined || Object.keys(context.commandOverrides).length === 0
      ? {}
      : { commandOverrides: context.commandOverrides }),
  };
  return Object.keys(options).length === 0 ? undefined : options;
}
async function check(
  context: TaskGoalContext,
  patch: string,
  override?: {
    readonly contract: GoalContract;
    readonly challengePolicy: ChallengePolicy;
    readonly repositoryChecks?: "skip";
  },
): Promise<IndependentVerification> {
  try {
    return await verify(context, patch, override);
  } catch (cause) {
    // A policy decision against the change, named, is a result the gate feeds back and the
    // final assessment records; thrown through, it ended the run with no verdict at all.
    if (cause instanceof VerificationRefusalError) return refusedVerification(cause.message);
    throw cause;
  }
}

async function verify(
  context: TaskGoalContext,
  patch: string,
  override?: {
    readonly contract: GoalContract;
    readonly challengePolicy: ChallengePolicy;
    readonly repositoryChecks?: "skip";
  },
) {
  const gateOptions = verificationGateOptions(context);
  return verifyIndependently({
    repositoryRoot: context.workspace,
    // Shared with a container runtime where there is one; on the host, the system temporary
    // directory, outside any hidden path (see checkoutRoot).
    ...(context.isolation === null ? {} : { checkoutRoot: context.evidence.directory }),
    baseCommit: context.baseCommit,
    patch,
    commands: createNodeCommandRunner(
      context.clock,
      harnessChildEnvironment(),
      undefined,
      context.signal,
    ),
    clock: context.clock,
    signal: context.signal,
    goal: {
      contract: override?.contract ?? context.contract,
      evidence: context.evidence,
      tree: "",
      challengePolicy: override?.challengePolicy ?? context.challengePolicy ?? "off",
    },
    ...(override?.repositoryChecks === undefined
      ? {}
      : { repositoryChecks: override.repositoryChecks }),
    installDependencies: context.install,
    ...(gateOptions === undefined ? {} : { gateOptions }),
    commandsForCheckout: async (checkout) =>
      createNodeCommandRunner(
        context.clock,
        harnessChildEnvironment(),
        context.isolation === null
          ? undefined
          : recordedContainerBackend(
              { ...context.isolation, workspaceRoot: checkout },
              context.evidence,
            ),
        context.signal,
      ),
  });
}

/**
 * Establish the acceptance instrument on the base before any implementation call can consume
 * its budget: a bugfix or refactor needs its base control, and every contract needs checks
 * that can run here at all. A check whose toolchain is missing, or a fresh checkout that cannot
 * be prepared, is found now, with the remedy named, rather than after the model has spent the
 * interesting part of the budget. Upgrades are excluded: their checks assert the installed
 * version, which the base cannot have, and their authorization is enforced per candidate.
 */
export async function preflightTaskGoal(context: TaskGoalContext): Promise<void> {
  const kind = context.contract.preset?.kind;
  if (kind === "upgrade") return;
  const result = await check(context, "", { contract: context.contract, challengePolicy: "off" });
  const cannotRun = (result.goalAcceptance?.checkResults ?? []).filter(
    (check) => check.status === "unjudged",
  );
  const passesOnBase = (result.goalAcceptance?.checkResults ?? [])
    .filter((check) => check.status === "accepted")
    .map((check) => check.id);
  await context.evidence.record({
    type: "verification-command",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({
      rule: kind === undefined ? "goal-preflight-v1" : "preset-preflight-v1",
      sourceBase: context.baseCommit,
      ...(kind === undefined
        ? { cannotRun: cannotRun.map((check) => check.id), passesOnBase }
        : {}),
      ...result,
    }),
  });
  if (result.refusal !== null)
    throw new Error(
      `the acceptance checks cannot be established on the base: ${result.refusal}; repair the prepared environment before model spending`,
    );
  if (
    (kind === "bugfix" || kind === "refactor") &&
    result.goalAcceptance?.presetControl?.accepted !== true
  )
    throw new Error(
      `${kind} base control was not established; repair the reproducer or prepared environment before model spending`,
    );
  if (result.unmeasured)
    throw new Error(
      `${kind ?? "goal"} setup is unmeasured: ${result.advice || result.refusal}; prepare required tools before model spending`,
    );
  if (kind === undefined && cannotRun.length > 0)
    throw new Error(
      `acceptance check(s) cannot run here: ${cannotRun.map((check) => `${check.id} (${check.detail.split("\n")[0]})`).join("; ")}; prepare the tools they need before model spending`,
    );
}

/** What a goal preflight observed on the base, for the terminal: which checks already pass there. */
export function describeGoalPreflight(evidence: EvidenceRecorder): readonly string[] {
  const record = evidence
    .records()
    .findLast(
      (entry) =>
        entry.type === "verification-command" &&
        (evidence.payloads().get(entry.payloadDigest) as { rule?: string } | undefined)?.rule ===
          "goal-preflight-v1",
    );
  const payload = evidence.payloads().get(record?.payloadDigest ?? "") as
    | { passesOnBase?: string[] }
    | undefined;
  if (payload === undefined) return [];
  return payload.passesOnBase === undefined || payload.passesOnBase.length === 0
    ? ["preflight: every sealed check fails on the base, so a pass will mean the change did it"]
    : [
        `preflight: ${payload.passesOnBase.join(", ")} already pass on the base; a pass there is not evidence the change did anything`,
      ];
}

/** Project exact final-source acceptance into the recorded worker assessment. */
export async function finalizeTaskGoal(context: TaskGoalContext) {
  const patch = await patchAgainstBase({
    workspaceRoot: context.workspace,
    baseRef: context.baseCommit,
  });
  const result = await check(context, patch);
  const record = await context.evidence.record({
    type: "independent-verification",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({
      ...result,
      // The source as the worker's own diff record names it (zero-context), beside the digest of
      // the full-context patch the fresh checkout applied: two readings of one working tree.
      sourcePatchDigest: digestOfBytes(
        await diffAgainstBase({ workspaceRoot: context.workspace, baseRef: context.baseCommit }),
      ),
      appliedPatchDigest: digestOfBytes(patch),
      sourceBase: context.baseCommit,
    }),
  });
  return recordGoalAssessment(context.evidence, record.record.payloadDigest);
}

/** The candidate as it stands, judged under a contract with its checks challenged, and recorded. */
export async function verifyCandidateUnder(
  context: TaskGoalContext,
  contract: GoalContract,
  challengePolicy: ChallengePolicy,
) {
  const patch = await patchAgainstBase({
    workspaceRoot: context.workspace,
    baseRef: context.baseCommit,
  });
  const result = await check(context, patch, { contract, challengePolicy });
  await context.evidence.record({
    type: "independent-verification",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({
      ...result,
      // The source as the worker's own diff record names it (zero-context), beside the digest of
      // the full-context patch the fresh checkout applied: two readings of one working tree.
      sourcePatchDigest: digestOfBytes(
        await diffAgainstBase({ workspaceRoot: context.workspace, baseRef: context.baseCommit }),
      ),
      appliedPatchDigest: digestOfBytes(patch),
      sourceBase: context.baseCommit,
    }),
  });
  return result;
}

/**
 * A contract's checks on a fresh checkout of the unchanged base, after the repository's own
 * checks, exactly as the acceptance gate and the final verification run them. A planned check is
 * admitted by this, not by a probe that skips the build: one that imports the project's built
 * output could not run under the probe and would have run under acceptance.
 */
export function baseVerifier(context: TaskGoalContext) {
  return async (contract: GoalContract) =>
    (await check(context, "", { contract, challengePolicy: "off" })).goalAcceptance;
}

/** One admission probe: a patch on a fresh checkout of the base, only the probe contract judged. */
export function probeVerifier(context: TaskGoalContext) {
  return async (patch: string, contract: GoalContract) =>
    (await check(context, patch, { contract, challengePolicy: "off", repositoryChecks: "skip" }))
      .goalAcceptance;
}

/**
 * The workspace as it stands, judged under the sealed contract exactly as the acceptance gate
 * judges it, and recorded. Challenging the checks is the final verification's, and the
 * strengthening loop's, not every attempt's.
 */
async function judgeWorkspace(context: TaskGoalContext): Promise<IndependentVerification> {
  const patch = await patchAgainstBase({
    workspaceRoot: context.workspace,
    baseRef: context.baseCommit,
  });
  const result = await check(context, patch, {
    contract: context.contract,
    challengePolicy: "off",
  });
  await context.evidence.record({
    type: "independent-verification",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({
      ...result,
      // The source as the worker's own diff record names it (zero-context), beside the digest of
      // the full-context patch the fresh checkout applied: two readings of one working tree.
      sourcePatchDigest: digestOfBytes(
        await diffAgainstBase({ workspaceRoot: context.workspace, baseRef: context.baseCommit }),
      ),
      appliedPatchDigest: digestOfBytes(patch),
      sourceBase: context.baseCommit,
    }),
  });
  return result;
}

/** Feed captured behavior failures into the same bounded worker repair cycle. */
export function taskGoalGate(context: TaskGoalContext): GateDefinition {
  return taskGoalGates(context).acceptanceGate;
}

/**
 * The gates a sealed goal contract is judged through: one for the checks that decide its
 * requirements, and one for the generated checks that only inform, where it has any. They are
 * apart because the ratchet compares gates: in one gate, a live repair that answered a generated
 * check by breaking a supplied one left that gate failing exactly as before, so nothing regressed
 * by the ratchet's reading and the broken candidate was kept and delivered. Both read one
 * verification of the workspace per gate cycle (the cycle's context is the key), so the checks run
 * once a cycle, as they did with one gate, and nothing is reused across cycles.
 */
export function taskGoalGates(context: TaskGoalContext): {
  readonly acceptanceGate: GateDefinition;
  readonly diagnosticsGate: GateDefinition | null;
} {
  const digest = freezeGoalContract(context.contract).digest;
  const judged = new WeakMap<object, Promise<IndependentVerification>>();
  const verificationFor = (cycle: object) => {
    const known = judged.get(cycle);
    if (known !== undefined) return known;
    const started = judgeWorkspace(context);
    judged.set(cycle, started);
    return started;
  };
  const gate = (
    id: string,
    title: string,
    read: (result: IndependentVerification) => {
      readonly passes: boolean;
      readonly stderr: string;
      /** The checks this gate decides, each as a part the ratchet holds on its own. */
      readonly parts?: Readonly<Record<string, GateStatus>>;
    },
  ): GateDefinition => ({
    id,
    title,
    severity: "blocking",
    capability: "dynamic",
    parserName: "inspection",
    parse: inspectionParser,
    source: {
      kind: "inspection",
      inspect: async (cycle) => {
        const started = context.clock.now();
        const result = await verificationFor(cycle);
        const findings =
          result.goalAcceptance?.checkResults?.map(({ id: check, status, detail }) => ({
            id: check,
            status,
            detail,
          })) ?? [];
        const reading = read(result);
        return {
          exitCode: reading.passes ? 0 : 1,
          unavailable: null,
          durationMs: context.clock.now() - started,
          stdout: JSON.stringify({
            regression: result.regression,
            task: result.task,
            findings,
            ...(reading.parts === undefined ? {} : { parts: reading.parts }),
          }),
          stderr: reading.stderr,
        };
      },
    },
  });
  const acceptanceGate = gate(acceptanceGateId, `sealed goal ${digest}`, (result) => {
    const reading = readAcceptance(context.contract, result);
    // A refusal is a decision against the change and reads as one; an unmeasured setup is
    // something to prepare. The repair feedback is this text, so the two must not be confused.
    // The findings again as plain lines: inside the JSON above, a check's detail reaches the
    // repair brief escaped, and a worker reads the line it got wrong more easily here.
    const failed = (result.goalAcceptance?.checkResults ?? [])
      .filter((finding) => finding.status !== "accepted" && !reading.diagnostic.has(finding.id))
      .map((finding) => `check ${finding.id} ${finding.status}: ${finding.detail}`);
    // Each supplied check is a part of this gate: a repair that leaves one failing check failing
    // and breaks another passing one has regressed, though the gate failed before and after.
    const parts = Object.fromEntries(
      (result.goalAcceptance?.checkResults ?? [])
        .filter((finding) => !reading.diagnostic.has(finding.id))
        .map((finding) => [
          finding.id,
          finding.status === "accepted"
            ? ("passed" as const)
            : finding.status === "rejected"
              ? ("failed" as const)
              : ("not-applicable" as const),
        ]),
    );
    return {
      passes: reading.passes,
      parts,
      stderr:
        result.refusal !== null && !result.unmeasured
          ? `refused: ${result.refusal}`
          : reading.unavailable
            ? `setup unavailable: ${result.advice || result.refusal || "required acceptance instrument is unmeasured"}`
            : failed.join("\n"),
    };
  });
  const diagnostic = diagnosticChecks(context.contract);
  if (diagnostic.size === 0) return { acceptanceGate, diagnosticsGate: null };
  const diagnosticsGate = gate(
    diagnosticsGateId,
    `generated checks of sealed goal ${digest}`,
    (result) => {
      const disagreeing = (result.goalAcceptance?.checkResults ?? [])
        .filter((finding) => finding.status === "rejected" && diagnostic.has(finding.id))
        .map((finding) => {
          const relation = relationRun(context, result, finding.id);
          return relation === null
            ? `generated check ${finding.id} rejected: ${finding.detail}`
            : `generated relation ${finding.id} broke: inputs that differ only by the reference ${inputAsRead(relation.relation.reference)} or a variant gave different results:\n${relation.lines.join("\n")}`;
        });
      return {
        passes: disagreeing.length === 0,
        stderr:
          disagreeing.length === 0
            ? ""
            : [
                "These generated checks disagree with the change. Their expected results are the planner's reading of the task, not established facts: change the code where the task supports the expectation, and where it does not, leave the code as it is and say which expectation the task contradicts. A change that breaks a supplied check to satisfy one of these is rolled back.",
                ...disagreeing,
              ].join("\n"),
      };
    },
  );
  return { acceptanceGate, diagnosticsGate };
}

/**
 * What the acceptance gate makes of one verification, which is what repair answers to. A check
 * that decides a requirement passes or refuses; a generated check is the diagnostics gate's and
 * never this gate's; a requirement no check decides is unjudged by design, which is neither
 * something to fix nor a setup to prepare.
 */
export function readAcceptance(
  contract: GoalContract,
  result: {
    readonly verified: boolean;
    readonly unmeasured: boolean;
    readonly refusal: string | null;
    readonly regression: string;
    readonly goalAcceptance?: {
      readonly obligations: readonly { readonly id: string; readonly status: string }[];
      readonly checkResults?: readonly { readonly id: string; readonly status: string }[];
    };
  },
): {
  readonly passes: boolean;
  readonly unavailable: boolean;
  readonly diagnostic: ReadonlySet<string>;
} {
  const diagnostic = diagnosticChecks(contract);
  const decided = new Set(
    contract.requirements.filter((one) => one.checks.length > 0).map((one) => one.id),
  );
  const obligations = (result.goalAcceptance?.obligations ?? []).filter((one) =>
    decided.has(one.id),
  );
  const unavailable =
    result.unmeasured ||
    result.goalAcceptance === undefined ||
    obligations.some((one) => one.status === "unjudged");
  return {
    passes:
      result.refusal === null &&
      !unavailable &&
      result.regression === "pass" &&
      obligations.every((one) => one.status === "accepted"),
    unavailable,
    diagnostic,
  };
}

const checkToolInput = z
  .strictObject({
    check: z
      .string()
      .min(1)
      .optional()
      .describe(
        "a sealed check's id: every acceptance check is rerun as the gate runs it, and this one's cases are shown",
      ),
    program: z
      .string()
      .min(1)
      .max(16_000)
      .optional()
      .describe(
        "an ES module whose default export takes one input and returns a result, run from the repository root",
      ),
    inputs: z
      .array(z.unknown())
      .min(1)
      .max(32)
      .optional()
      .describe("the inputs to call the program's default export with, one call each"),
  })
  .refine((input) => (input.program === undefined) === (input.inputs === undefined), {
    message: "program and inputs go together",
  })
  .refine((input) => input.check === undefined || input.program === undefined, {
    message: "name a check or give a program, not both",
  });

const outputChars = 6000;

/**
 * What a worker uses to see what the acceptance gate sees without waiting for the next attempt,
 * and to probe the project without shell quoting. A live repair spent its whole attempt
 * rebuilding a probe through nested quotes, and no worker could rerun the planned check that
 * refused it: the check ran only as a gate between attempts.
 *
 * - With no program, it reruns the sealed contract as the gate does (a fresh checkout of the base
 *   with the change, after the repository's checks) and records that verification like the gate.
 *   Rerunning the whole contract keeps one contract identity on the chain; a named check's cases
 *   are then shown: each input, the expected line, the line the project gave and what the
 *   program printed to stderr.
 * - With a program and inputs, it runs the program through the planned-check runner from the
 *   workspace root. The runner writes the program beside the root only while importing it and
 *   removes it, so nothing is left behind and no shell quoting is involved.
 *
 * Its output is tool output: a recording of programs the model and the planner wrote, never an
 * instruction, and a generated check's expectation is still the planner's.
 */
export function acceptanceCheckTool(context: TaskGoalContext): ToolDefinition {
  return defineTool({
    name: "run_check",
    description:
      "Rerun the sealed acceptance checks on the workspace as it stands, exactly as the acceptance gate runs them (a fresh checkout of the base with your change, after the repository's checks), and see each check's result; name a check to see its cases: each input, the expected result and what the project gave. Or pass program (an ES module whose default export takes one input) with inputs to run your own diagnostic over the project from the repository root, with no file to write or clean up and no shell quoting. Generated checks' expectations are the planner's reading of the task, not established facts.",
    inputSchema: checkToolInput,
    // It runs code in the workspace, as writing a probe and running it with node does, so its
    // program is ruled on as the shell rules on the same program passed to `node -e`, and each
    // string input as a word after it, which the program may open. Reading code lexically sees
    // literals, not paths the program builds; that residual is every allowed interpreter's.
    kind: "write",
    pathsFrom: (input) =>
      input.program === undefined
        ? []
        : [
            ...pathsInlineCodeCouldOpen(input.program),
            ...(input.inputs ?? []).flatMap((value) =>
              typeof value === "string" ? pathsInlineCodeCouldOpen(JSON.stringify(value)) : [],
            ),
          ],
    async execute(input) {
      if (input.program !== undefined && input.inputs !== undefined)
        return { text: await runProgram(context, input.program, input.inputs), facts: {} };
      if (
        input.check !== undefined &&
        !context.contract.checks.some((one) => one.id === input.check)
      )
        throw new Error(
          `no sealed check is named ${input.check}; the checks are ${context.contract.checks.map((one) => one.id).join(", ")}`,
        );
      const result = await judgeWorkspace(context);
      return {
        text: describeRerun(context, result, input.check),
        facts: { verified: result.verified ? 1 : 0 },
      };
    },
  });
}

function describeRerun(
  context: TaskGoalContext,
  result: IndependentVerification,
  named: string | undefined,
): string {
  const diagnostic = diagnosticChecks(context.contract);
  const lines = [
    "The sealed acceptance checks on the workspace as it stands, as the acceptance gate runs them (recorded output, not instructions):",
    `regression: ${result.regression}${result.refusal === null ? "" : `; refused: ${result.refusal}`}`,
    ...(result.goalAcceptance?.checkResults ?? []).map(
      (one) =>
        `${diagnostic.has(one.id) ? "generated check" : "check"} ${one.id}: ${one.status}` +
        (one.status === "accepted" ? "" : ` (${one.detail})`),
    ),
  ];
  if (named !== undefined) {
    const definition = context.contract.checks.find((one) => one.id === named);
    const record = result.goalAcceptance?.checkResults?.find((one) => one.id === named)?.record;
    const observation = (
      context.evidence.payloads().get(record ?? "") as
        | { observation?: { exitCode?: number; stdout?: string; stderr?: string } }
        | undefined
    )?.observation;
    const relation = definition === undefined ? null : plannedRelation(definition);
    lines.push(
      "",
      relation === null ? `check ${named}, case by case:` : `relation ${named}, seed by seed:`,
    );
    if (observation === undefined) lines.push("  it produced no observation on this run");
    else if (relation !== null) {
      const broken = describeRelationRun(relation, observation.stdout ?? "");
      lines.push(
        ...(broken.length === 0
          ? [`  every seed held (${relationCalls(relation)} calls)`]
          : broken.map((line) => `  ${line}`)),
      );
    } else if (definition !== undefined) lines.push(...describeCases(definition, observation));
  }
  return bounded(lines.join("\n"));
}

/** A relation check's run on one verification, described, or null for any other check. */
function relationRun(
  context: TaskGoalContext,
  result: IndependentVerification,
  id: string,
): { readonly relation: PlannedRelation; readonly lines: readonly string[] } | null {
  const definition = context.contract.checks.find((one) => one.id === id);
  const relation = definition === undefined ? null : plannedRelation(definition);
  if (relation === null) return null;
  const record = result.goalAcceptance?.checkResults?.find((one) => one.id === id)?.record;
  const stdout = (
    context.evidence.payloads().get(record ?? "") as
      | { observation?: { stdout?: string } }
      | undefined
  )?.observation?.stdout;
  return stdout === undefined ? null : { relation, lines: describeRelationRun(relation, stdout) };
}

function describeCases(
  definition: GoalContract["checks"][number],
  observation: { exitCode?: number; stdout?: string; stderr?: string },
): readonly string[] {
  const inputs = plannedInputs(definition);
  const behavior = definition.behavior;
  const expected =
    behavior?.kind === "cli" &&
    behavior.stdout.length === 1 &&
    behavior.stdout[0]?.kind === "equals"
      ? behavior.stdout[0].value.split("\n")
      : null;
  const actual = (observation.stdout ?? "").split("\n");
  const cases =
    inputs === null || expected === null
      ? [
          `  expected: ${JSON.stringify(behavior?.kind === "cli" ? behavior.stdout : definition.command)}`,
          `  stdout: ${observation.stdout ?? ""}`,
        ]
      : inputs.map(
          (one, index) =>
            `  input ${inputAsRead(one)}: expected ${expected[index] ?? "(nothing)"}; got ${actual[index] ?? "(nothing)"}` +
            (expected[index] === actual[index] ? "" : "  <- differs"),
        );
  return [
    `  exit ${observation.exitCode ?? "unknown"}`,
    ...cases,
    ...((observation.stderr ?? "").trim().length === 0
      ? []
      : [
          "  stderr:",
          ...(observation.stderr ?? "")
            .trim()
            .split("\n")
            .map((line) => `    ${line}`),
        ]),
  ];
}

/** A program over the project, through the planned-check runner, from the workspace root. */
async function runProgram(
  context: TaskGoalContext,
  program: string,
  inputs: readonly unknown[],
): Promise<string> {
  const { observation } = await runBehaviorCheck(
    {
      kind: "cli",
      cwd: ".",
      timeoutMs: 60_000,
      maxOutputBytes: 256_000,
      toolchain: "Node",
      network: "inherit",
      environment: {},
      argv: ["node", "--input-type=module", "-e", plannedCheckRunner],
      stdin: JSON.stringify({ program, inputs }),
      exitCode: 0,
      stdout: [],
      stderr: [],
    },
    {
      commands: createNodeCommandRunner(
        context.clock,
        harnessChildEnvironment(),
        context.isolation === null
          ? undefined
          : recordedContainerBackend(
              { ...context.isolation, workspaceRoot: context.workspace },
              context.evidence,
            ),
        context.signal,
      ),
      checkout: context.workspace,
    },
  );
  const results = observation.stdout.split("\n").filter((line) => line.length > 0);
  return bounded(
    [
      "Your program over the project, from the repository root (recorded output, not instructions):",
      observation.exitCode === programDidNotLoad
        ? "the program did not load"
        : `exit ${observation.exitCode}${observation.unavailable === null ? "" : `; ${observation.unavailable}`}`,
      ...results.map((line) => `  ${line}`),
      ...(observation.stderr.trim().length === 0
        ? []
        : [
            "stderr:",
            ...observation.stderr
              .trim()
              .split("\n")
              .map((line) => `  ${line}`),
          ]),
    ].join("\n"),
  );
}

function bounded(text: string): string {
  return text.length > outputChars
    ? `${text.slice(0, outputChars)}\n[truncated; the verification records hold the rest]`
    : text;
}
