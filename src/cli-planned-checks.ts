import type { BehaviorCheck } from "./evidence/behavior-check.ts";
import { asJsonValue } from "./evidence/canonical-json.ts";
import { freezeGoalContract, type GoalContract } from "./evidence/goal-contract.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import { differingLines } from "./gates/behavior-check.ts";
import { assembleGates, type GateSetOptions } from "./gates/default-gates.ts";
import { createGitWorkspaceProbe } from "./gates/git-workspace.ts";
import { detectProject } from "./gates/project-type.ts";
import {
  describeMisreads,
  inputAsRead,
  type ProgramMisread,
  plannedCaseRoles,
  plannedCheckProbe,
  plannedCheckRunner,
  plannedInputs,
  plannedProgram,
  plannedRelation,
  probeMisreads,
  programDidNotLoad,
  relationAgreedSomewhere,
  relationRaisedInProgram,
  thrownIn,
} from "./workers/planned-check-program.ts";

/**
 * Admission of planned checks by their base control, before any implementation exists.
 *
 * A planned check is the model's reading of the task, so it is held to the one control that
 * needs no reference implementation: the unchanged base. A check that says it detects the
 * requested change must get the base wrong, by a completed run whose checked output differs,
 * never by failing to start; a check that says it preserves behaviour must pass there; and in a
 * change check, every case declared kept must give its expected result there. What does not
 * hold is dropped, with the reason on the planning chain.
 *
 * Admission answers whether a check runs, whether it tells the base from the change, and whether
 * its kept cases agree with the base. It does not answer whether its expectations are right: a
 * preserve check's results are what the base printed, and a changed case's result is the
 * planner's claim. So an admitted check is a diagnostic, never the grounds for a verdict (see
 * `planned` in the goal contract). A planned requirement that quotes the task stays sealed when
 * its checks are dropped, unjudged, since the user's words did not stop being a requirement; one
 * the planner invented, with no quote and no admitted check, is dropped and reported as
 * unsupported.
 *
 * Output diversity is neither necessary nor sufficient for a valid check. A defect can be one
 * answer for every input (a predicate that is always false), and a program that varies can still
 * call the wrong interface. So a check whose base answers are one value is not refused for that:
 * it is kept with its control unestablished and the uncertainty recorded, unless something shows
 * the program itself broken (it did not load, did not complete, threw in its own code, or a
 * separate probe saw it read the case's fields off the input it was given while every answer was
 * the same).
 *
 * A thrown case is read by where the runner saw it thrown. Thrown in the check program's own
 * module, the case recorded no answer of the project's, so it is no observation of the base and
 * the check is refused for a revision, however uniform or varied the other answers were: D1's
 * one case applied `in` to the string the project returned and read as the base disagreeing with
 * an input the task names. Thrown outside the program, it is the project's answer and stays one,
 * as a diagnostic of a crashing base or as a declared throw met. Thrown where no frame names a
 * file, it is read as the base's answer with that uncertainty recorded beside it.
 */
/**
 * One case where the base's answer differs from what a check expects of behaviour it says stays:
 * every case of a preserve check, a kept case of a change check. The expectation and the answer are
 * each the result as JSON text, null where the base printed nothing for the case.
 */
export interface CaseDisagreement {
  /** 1-based, in the check's own order. */
  readonly case: number;
  readonly input: unknown;
  readonly expected: string;
  readonly base: string | null;
  /**
   * Whether the task's own text names this input verbatim. Where it does, the task may be stating
   * the outcome it wants for that input, which the base can lack; where it does not, nothing but
   * the planner's reading backs the expectation. Either way it is a reading, never a verdict.
   */
  readonly namedByTask: boolean;
}

export interface PlannedCheckDecision {
  readonly check: string;
  readonly atBase: "fails" | "passes" | null;
  readonly observed: "accepted" | "rejected" | "unjudged" | "not-run";
  /** Kept in the sealed contract: admitted with a control, or with its control unestablished. */
  readonly admitted: boolean;
  readonly reason: string;
  /**
   * What its expected results rest on: the base's own output (a preserve check), or the
   * planner's claim of what the change produces (a change check). Neither is independent
   * evidence that the expectation is what the task means.
   */
  readonly basis: "base-observed" | "model-asserted";
  /**
   * Of a completed base run, how many of its cases expect something other than what the base
   * printed: the cases whose expectation only the planner vouches for. Null where the base run
   * did not complete or the check has no case-by-case output.
   */
  readonly claimedChanges: { readonly cases: number; readonly of: number } | null;
  /**
   * Dropped because nothing it printed can be read as the project's answer (it did not run to
   * completion, could not be judged, or was shown to misread its input), as against a result
   * that contradicts its claim.
   */
  readonly broken: boolean;
  /**
   * What the base run showed about the check, each kind with its own remedy: the program did not
   * load (an import), it read a case's own fields off the input it was given (the argument's
   * shape, seen by the probe while every answer was one value), it did not finish, a case threw
   * in the program's own code (so the case observed nothing of the project), its control is
   * unestablished (kept, an uncertainty rather than a failure of the project or the program), its
   * expectation contradicts what the base does where the task keeps behaviour, or, for a change
   * check, the base already passes it.
   */
  readonly finding:
    | "admitted"
    | "unestablished-control"
    | "not-run"
    | "unjudged"
    | "did-not-load"
    | "argument-shape"
    | "did-not-complete"
    | "raised-in-program"
    | "expectation-contradicted"
    | "disagrees-with-base"
    | "reclassification-unsupported"
    | "does-not-detect"
    | "adopts-base-answer";
  /**
   * The cases where the base disagrees with what the check expects of behaviour that stays, each
   * with whether the task names its input; null where no case-by-case comparison was made. A
   * disagreement shows the expectation and the base differ, not which of them the task backs.
   */
  readonly disagreements: readonly CaseDisagreement[] | null;
  /**
   * Of a check of cases, each case that threw on the base and where the runner saw it thrown: in
   * the check program's own code, outside it (the project or what it calls), or where no stack
   * frame names a file. Null where no case threw or nothing was compared. Where it was thrown, not
   * whose fault it was: a program that passes the project a wrong argument gets the project's throw.
   */
  readonly thrown:
    | readonly {
        readonly case: number;
        readonly in: "check-program" | "outside-program" | "unattributed";
      }[]
    | null;
  /**
   * Declared again as a change under the id of a preserve check the base disagreed with. Held to
   * the change control like any change check, and admitted only for changed cases whose inputs the
   * task names: the planner's justification is in the check's why, recorded with the revision.
   */
  readonly reclassified: boolean;
  /**
   * What shows the program observes the project through the very adapter, fixture and input
   * convention the changed cases use, or null where nothing does. Base agreement: the base gave
   * the expected result for these (1-based) kept cases, its answers are not all one value, and
   * the kept cases' inputs are of the kinds the changed cases' are. A shared program: another
   * planned check runs this exact program and has such a control. A relation: some variant
   * behaved like the reference somewhere on the base.
   */
  readonly control: {
    readonly source: "base-agreement" | "shared-program" | "relation-agreement";
    readonly cases: readonly number[];
    /** For a shared program, the check whose control it is. */
    readonly check?: string;
  } | null;
  /** What the base run establishes about this check, in words; null where it was dropped. */
  readonly establishes: string | null;
  /** What remains unknown after admission, in words; null where it was dropped. */
  readonly unknown: string | null;
  /** Observations beside the decision that do not decide it, such as a probe's reading. */
  readonly notes: readonly string[];
  /**
   * What the planner is shown to revise a dropped check: for a broken one, the start of what it
   * printed on the base; for a contradicted one, the cases it got wrong with what the base gave.
   * Null for an admitted check, and for a change check the base already satisfies, whose base
   * results are its own expectations and would only invite fitting them.
   */
  readonly excerpt: string | null;
  readonly record: string | null;
  /** The argument probe's record beside the check's own, where one ran. */
  readonly probeRecord: string | null;
}

/**
 * An input the task names on which a base run disagreed with what a check of the requirement
 * expected: the base's answer there and the expectation it contradicted. A later check that expects
 * the base's answer for that input would hold the base's behaviour where the task names the input,
 * and nothing here tells whether the first expectation or the base is what the task asks for.
 */
export interface ContestedInput {
  readonly requirement: string;
  readonly check: string;
  readonly input: unknown;
  readonly expected: string;
  readonly base: string;
}

export interface PlannedCheckAdmission {
  /** The supplied contract plus every admitted addition; null where nothing usable remains. */
  readonly contract: GoalContract | null;
  readonly decisions: readonly PlannedCheckDecision[];
  /** Planned requirements dropped: invented, with no quote of the task and no admitted check. */
  readonly droppedRequirements: readonly string[];
  /** Planned requirements in the task's words that kept no admitted check, sealed unjudged. */
  readonly unverifiedRequirements: readonly string[];
}

interface ObservedCheck {
  readonly status: "accepted" | "rejected" | "unjudged";
  readonly completed: boolean;
  readonly exitCode: number | null;
  readonly unavailable: string | null;
  readonly stdout: string;
  readonly output: string;
  readonly record: string;
}

/**
 * The argument probe of each planned check, as checks of the base run's own contract under ids
 * no planned check has: the same program and stdin, the probe's argv, nothing expected of its
 * output. Never sealed and never judged; admission reads what each printed.
 */
function argumentProbes(
  planned: readonly GoalContract["checks"][number][],
): readonly { readonly of: string; readonly check: GoalContract["checks"][number] }[] {
  const taken = new Set(planned.map((check) => check.id));
  let next = 0;
  const freshId = () => {
    let id = "";
    do {
      next += 1;
      id = `argument-probe-${next}`;
    } while (taken.has(id));
    taken.add(id);
    return id;
  };
  return planned.flatMap((check) => {
    const behavior = check.behavior;
    if (behavior?.kind !== "cli" || behavior.argv[3] !== plannedCheckRunner) return [];
    const { atBase: _atBase, ...rest } = check;
    return [
      {
        of: check.id,
        check: {
          ...rest,
          id: freshId(),
          command: `argument probe of planned check ${check.id}`,
          behavior: {
            ...behavior,
            argv: ["node", "--input-type=module", "-e", plannedCheckProbe],
            exitCode: 0,
            stdout: [],
            stderr: [],
          },
        },
      },
    ];
  });
}

export async function admitPlannedChecks(input: {
  /** The task in the user's words, which a case's input may name; the contract's goal where absent. */
  readonly task?: string;
  readonly contract: GoalContract;
  readonly base: GoalContract | undefined;
  /** The planning chain, which the base run writes its check records to. */
  readonly evidence: EvidenceRecorder;
  /** Runs a contract's checks on a fresh checkout of the unchanged base. */
  readonly verifyAtBase: (contract: GoalContract) => Promise<unknown>;
  /** Planned checks a revision declared as changes under the ids of dropped preserve checks. */
  readonly reclassified?: ReadonlySet<string>;
  /** Task-named inputs earlier base runs of this planning disagreed on, by requirement. */
  readonly contested?: readonly ContestedInput[];
}): Promise<PlannedCheckAdmission> {
  const task = input.task ?? input.contract.goal;
  const requirementOf = (check: string) =>
    input.contract.requirements.find(
      (one) => one.planned?.diagnostics.includes(check) === true || one.checks.includes(check),
    )?.id;
  const supplied = new Set((input.base?.checks ?? []).map((check) => check.id));
  const planned = input.contract.checks.filter((check) => !supplied.has(check.id));
  const probes = argumentProbes(planned);
  const mark = input.evidence.records().length;
  if (planned.length > 0)
    await input.verifyAtBase(
      freezeGoalContract({
        version: 1,
        goal: input.contract.goal,
        requirements: [
          {
            id: "planned-at-base",
            description: "each planned check on the unchanged base",
            checks: planned.map((check) => check.id),
          },
          ...(probes.length === 0
            ? []
            : [
                {
                  id: "argument-probes",
                  description: "how each planned program reads its input, apart from its checks",
                  checks: probes.map((probe) => probe.check.id),
                },
              ]),
        ],
        checks: [...planned, ...probes.map((probe) => probe.check)],
        immutablePaths: input.contract.immutablePaths,
      }).contract,
    );
  const observed = observedChecks(input.evidence, mark);
  const probeOf = (id: string) => {
    const probe = probes.find((one) => one.of === id);
    const seen = probe === undefined ? undefined : observed.get(probe.check.id);
    return {
      misread: seen?.completed === true ? probeMisreads(seen.stdout) : null,
      record: seen?.record ?? null,
    };
  };
  const decisions = withSharedPrograms(
    planned,
    planned.map((check) =>
      decide(check, observed.get(check.id), probeOf(check.id), {
        task,
        reclassified: input.reclassified?.has(check.id) === true,
        contested: (input.contested ?? []).filter(
          (one) => one.requirement === requirementOf(check.id),
        ),
      }),
    ),
  );
  const admitted = new Set(decisions.filter((one) => one.admitted).map((one) => one.check));
  const kept = new Set([...supplied, ...admitted]);
  const suppliedRequirements = new Set((input.base?.requirements ?? []).map((one) => one.id));
  const requirements = input.contract.requirements.flatMap((requirement) => {
    if (suppliedRequirements.has(requirement.id) || requirement.planned === undefined)
      return [requirement];
    const diagnostics = requirement.planned.diagnostics.filter((id) => kept.has(id));
    if (diagnostics.length === 0 && requirement.planned.quote === undefined) return [];
    return [{ ...requirement, planned: { ...requirement.planned, diagnostics } }];
  });
  const droppedRequirements = input.contract.requirements
    .filter((requirement) => !requirements.some((one) => one.id === requirement.id))
    .map((requirement) => requirement.id);
  const unverifiedRequirements = requirements
    .filter((one) => one.planned !== undefined && one.planned.diagnostics.length === 0)
    .map((one) => one.id);
  // Without a supplied contract and with nothing admitted there is nothing executable to implement
  // against, which ends planning as it did; the quoted requirements are still named.
  const contract =
    requirements.length === 0 || (input.base === undefined && admitted.size === 0)
      ? null
      : freezeGoalContract({
          ...input.contract,
          requirements,
          checks: input.contract.checks.filter((check) => kept.has(check.id)),
        }).contract;
  await input.evidence.record({
    type: "verification-command",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({
      rule: "planned-check-admission-v4",
      decisions,
      droppedRequirements,
      unverifiedRequirements,
      admittedContract: contract === null ? null : freezeGoalContract(contract).digest,
    }),
  });
  return { contract, decisions, droppedRequirements, unverifiedRequirements };
}

/** The completed goal-check records the base run wrote after `mark`, by check id. */
function observedChecks(
  evidence: EvidenceRecorder,
  mark: number,
): ReadonlyMap<string, ObservedCheck> {
  const found = new Map<string, ObservedCheck>();
  for (const record of evidence.records().slice(mark)) {
    if (record.type !== "goal-check") continue;
    const payload = evidence.payloads().get(record.payloadDigest) as
      | {
          phase?: string;
          checkId?: string;
          status?: "accepted" | "rejected" | "unjudged";
          behavior?: { exitCode?: number };
          observation?: {
            exitCode?: number;
            unavailable?: string | null;
            outputTruncated?: boolean;
            stdout?: string;
            stderr?: string;
          };
        }
      | undefined;
    if (
      payload?.phase !== "completed" ||
      payload.checkId === undefined ||
      payload.status === undefined
    )
      continue;
    found.set(payload.checkId, {
      status: payload.status,
      // A completed run: it exited as the check expects a finished script to, and its output was
      // read whole. A script that could not import the project is not a run that got it wrong.
      completed:
        payload.observation?.unavailable === null &&
        payload.observation.outputTruncated !== true &&
        payload.observation.exitCode === payload.behavior?.exitCode,
      exitCode: payload.observation?.exitCode ?? null,
      unavailable: payload.observation?.unavailable ?? null,
      stdout: payload.observation?.stdout ?? "",
      output: `exit ${payload.observation?.exitCode ?? "unknown"}; stderr: ${(payload.observation?.stderr ?? "").slice(0, excerptChars)}; stdout: ${(payload.observation?.stdout ?? "").slice(0, excerptChars)}`,
      record: record.payloadDigest,
    });
  }
  return found;
}

const excerptChars = 1200;

/** The one stdout equality a planned check is judged by, where it has one. */
function expectedStdout(check: GoalContract["checks"][number]): string | null {
  const behavior: BehaviorCheck | undefined = check.behavior;
  if (behavior?.kind !== "cli") return null;
  const [only] = behavior.stdout;
  return behavior.stdout.length === 1 && only?.kind === "equals" ? only.value : null;
}

/** What the base answered for each case, without the input it echoes: the program's answers. */
function answers(stdout: string): readonly string[] {
  return stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        const { input: _input, ...answer } = JSON.parse(line) as Record<string, unknown>;
        return JSON.stringify(answer);
      } catch {
        return line;
      }
    });
}

/** A JSON value's kind, the input convention a control has to share with what it controls. */
function kindOf(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

/**
 * Each case of a check of cases on the base: whether the base gave its expected line, and its
 * declared role (null where the check predates roles).
 */
function caseRows(
  check: GoalContract["checks"][number],
  seen: ObservedCheck,
): readonly {
  index: number;
  agrees: boolean;
  role: "changed" | "kept" | null;
  kind: string;
  input: unknown;
  expected: string;
  base: string | null;
  thrown: ReturnType<typeof thrownIn>;
}[] {
  const expected = expectedStdout(check);
  const inputs = plannedInputs(check);
  if (expected === null || inputs === null) return [];
  const roles = plannedCaseRoles(check);
  const want = expected.split("\n").filter((line) => line.length > 0);
  const got = seen.stdout.split("\n");
  return want.map((line, index) => ({
    index: index + 1,
    agrees: got[index] === line,
    role: roles?.[index] ?? null,
    kind: kindOf(inputs[index]),
    input: inputs[index],
    expected: resultText(line),
    base: got[index] === undefined || got[index] === "" ? null : resultText(got[index]),
    thrown: got[index] === undefined ? null : thrownIn(got[index]),
  }));
}

/** A case's line as its result alone, without the input it echoes: `"big"` for `{"input":50,"result":"big"}`. */
function resultText(line: string): string {
  try {
    const { input: _input, ...rest } = JSON.parse(line) as Record<string, unknown>;
    const keys = Object.keys(rest);
    return keys.length === 1 && keys[0] === "result"
      ? (JSON.stringify(rest.result) ?? "null")
      : JSON.stringify(rest);
  } catch {
    return line;
  }
}

/**
 * Whether the task's text names this input verbatim, as a whole token: a string or number of at
 * least three characters, not inside a longer word or number. Shorter inputs ("10", "a") occur in
 * almost any text, so they are never read as named.
 */
export function namedByTask(task: string, input: unknown): boolean {
  const text =
    typeof input === "string"
      ? input
      : typeof input === "number" && Number.isFinite(input)
        ? String(input)
        : null;
  if (text === null || text.trim().length < 3) return false;
  const wordy = (character: string | undefined) =>
    character !== undefined && /[\p{L}\p{N}_]/u.test(character);
  for (let at = task.indexOf(text); at >= 0; at = task.indexOf(text, at + 1)) {
    const opensOnWord = wordy(text[0]) && wordy(task[at - 1]);
    const closesOnWord = wordy(text.at(-1)) && wordy(task[at + text.length]);
    if (!opensOnWord && !closesOnWord) return true;
  }
  return false;
}

/** The disagreeing rows of a comparison, as the decision records them. */
function disagreementsOf(
  rows: ReturnType<typeof caseRows>,
  task: string,
): readonly CaseDisagreement[] {
  return rows
    .filter((row) => !row.agrees)
    .map((row) => ({
      case: row.index,
      input: row.input,
      expected: row.expected,
      base: row.base,
      namedByTask: namedByTask(task, row.input),
    }));
}

/**
 * Why a preserve check the base fails is dropped, without reading the failure as the requested
 * behaviour being wrong: the base and the expectation differ, and the task decides which is meant.
 */
function preserveDisagreement(disagreements: readonly CaseDisagreement[]): string {
  const cases = disagreements.map((one) => one.case);
  const named = disagreements.filter((one) => one.namedByTask).map((one) => one.case);
  return [
    cases.length === 0
      ? "it fails on the base."
      : `it fails on the base: case(s) ${cases.join(", ")} do not give their expected results there.`,
    "That is a disagreement with the base, not a finding that the requested behaviour is wrong: either an expectation misreads what the base does and is corrected, or the task asks for an outcome the base does not give yet, which makes the case a change (changed: true in a change check, with the task's words in why).",
    cases.length === 0
      ? ""
      : named.length > 0
        ? `The task names the input of case ${named.join(", ")} itself, so the outcome it states there may be the one it asks for.`
        : "The task names none of these inputs, so nothing but the planner's reading backs these expectations.",
  ]
    .filter((part) => part.length > 0)
    .join(" ");
}

/**
 * The control a check of cases has on the base: the cases whose expected line the base printed,
 * provided the base's answers are not all one value and those cases' inputs are of the kinds the
 * other cases' are. Agreement alone is not a control. A live planner's programs passed undefined
 * to the project, which answered null for every case, and their null-expecting cases agreed; an
 * empty fixture, a call to the wrong method and an ignored input give one answer everywhere in
 * the same way, and so does a defect that answers one value. Where the answers differ, the
 * program's answer depends on its input, and the agreeing cases show the planner's expectation and
 * the project's behaviour meeting through the same adapter as the other cases. Null where there
 * is no such case, which is an inability to establish a control, not a failure of the project.
 */
function casesControl(
  check: GoalContract["checks"][number],
  seen: ObservedCheck,
): PlannedCheckDecision["control"] {
  const rows = caseRows(check, seen);
  const agreeing = rows.filter((row) => row.agrees);
  const kinds = new Set(agreeing.map((row) => row.kind));
  const sameConvention = rows.every((row) => row.agrees || kinds.has(row.kind));
  const distinct = new Set(answers(seen.stdout)).size;
  return agreeing.length > 0 && distinct > 1 && sameConvention
    ? { source: "base-agreement", cases: agreeing.map((row) => row.index) }
    : null;
}

/**
 * A check whose own answers were one value takes the control of another planned check that runs
 * the exact same program (adapter and fixture) on inputs of the same kinds, where that one has a
 * base-agreement control: that run shows this program's answers depend on its input there.
 */
function withSharedPrograms(
  planned: readonly GoalContract["checks"][number][],
  decisions: readonly PlannedCheckDecision[],
): readonly PlannedCheckDecision[] {
  const programOf = (id: string) => {
    const check = planned.find((one) => one.id === id);
    return check === undefined ? null : plannedProgram(check);
  };
  const kindsOf = (id: string, cases?: readonly number[]) => {
    const check = planned.find((one) => one.id === id);
    const inputs = check === undefined ? null : plannedInputs(check);
    return new Set(
      (inputs ?? [])
        .filter((_, index) => cases === undefined || cases.includes(index + 1))
        .map(kindOf),
    );
  };
  return decisions.map((decision) => {
    if (decision.finding !== "unestablished-control") return decision;
    const check = planned.find((one) => one.id === decision.check);
    const program = programOf(decision.check);
    if (check === undefined || program === null || plannedRelation(check) !== null) return decision;
    const needed = kindsOf(decision.check);
    const lender = decisions.find(
      (other) =>
        other.check !== decision.check &&
        other.control?.source === "base-agreement" &&
        programOf(other.check) === program &&
        [...needed].every((kind) => kindsOf(other.check, other.control?.cases).has(kind)),
    );
    if (lender === undefined) return decision;
    return {
      ...decision,
      finding: "admitted",
      reason: `${decision.atBase === "passes" ? "it passes on the base, which keeps the behaviour it checks" : "it completes on the base with a wrong result where the task changes it"}, and every case gave one answer there; its control is planned check ${lender.check}'s, which runs this exact program on inputs of the same kinds`,
      control: { source: "shared-program", cases: [], check: lender.check },
      ...controlWords({ source: "shared-program", cases: [], check: lender.check }, null),
    };
  });
}

/** What a control establishes and what it leaves unknown, in words for the record and the planner. */
function controlWords(
  control: PlannedCheckDecision["control"],
  atBase: "fails" | "passes" | null,
): { readonly establishes: string; readonly unknown: string } {
  const meaning =
    "whether the expected results of the changed cases are what the task means, and whether the program calls the interface the task names: an answer that varies with the input does not show that";
  if (control === null)
    return {
      establishes: "the program loads and completes on the base",
      unknown: `whether it reaches the behaviour the task ${atBase === "passes" ? "keeps" : "changes"}: one answer for every case is what a defect that answers one value gives, and also what an ignored input, an empty fixture or a wrong call gives; ${meaning}`,
    };
  if (control.source === "relation-agreement")
    return {
      establishes:
        "on the base, some variant gives what the reference gives somewhere, through this program",
      unknown:
        "whether the equivalence is the task's rule beyond this program's fixture: equal results under one fixture do not show equal results under every supported configuration",
    };
  return control.source === "shared-program"
    ? {
        establishes: `planned check ${control.check} runs this exact program on inputs of the same kinds, and there the base's answers vary and its kept cases agree`,
        unknown: `this check's own answers were one value on the base; ${meaning}`,
      }
    : {
        establishes: `on the base this program's answers vary with its input, and case(s) ${control.cases.join(", ")} give their expected results through the same program, fixture and kind of input as the others`,
        unknown: meaning,
      };
}

const remedies = {
  "argument-shape":
    "its program read a field of the value it was called with as though it were the case, and every case gave the same answer, which is what passing undefined to the project gives; a program that reads the field and falls back to the value (x.input ?? x) answers these cases the same way, so nothing here tells the two apart and the check is refused rather than trusted. The program is called with each case's input itself (the string, number or object written as input), never with { input, expected }: take the input as the parameter and read no field of it",
  "did-not-complete":
    "it fails on the base without completing, which shows a broken check rather than the missing change",
  "unestablished-change":
    "kept with its control unestablished: on the base every case gave one and the same answer. That is what a defect that answers one value gives, and also what a program that ignores its input, builds an empty or wrongly built fixture, or calls the wrong function gives, and nothing here tells those apart. Where the defect is not one answer for everything, check that the program passes its input to the project and builds what it calls as the repository's own tests do, and add a kept case (changed: false) whose answer on the base differs from the changed cases' answers",
  "unestablished-preserve":
    "kept with its control unestablished: it passes on the base, and every case gave one and the same answer there, which a program that ignores its input or builds an empty fixture also gives, so a pass shows little until something varies; a case whose kept answer differs, through the same program, would establish it",
  "unestablished-relation":
    "kept with its control unestablished: no variant behaved like the reference at any position of any seed on the base, so nothing shows the program observes the project correctly; give it a seed, or a position, the base already treats alike",
  "no-kept-case":
    "kept with its control unestablished: it holds no case the task keeps (changed: false) that the base gets right, so nothing shows the program calls the project correctly; add one whose answer on the base differs from the changed cases' answers",
} as const;

function decide(
  check: GoalContract["checks"][number],
  seen: ObservedCheck | undefined,
  probe: { readonly misread: readonly ProgramMisread[] | null; readonly record: string | null },
  context: {
    readonly task: string;
    readonly reclassified: boolean;
    readonly contested?: readonly ContestedInput[];
  },
): PlannedCheckDecision {
  const atBase = check.atBase ?? null;
  const relation = plannedRelation(check);
  const expected = expectedStdout(check);
  const basis =
    check.atBase === "passes" ? ("base-observed" as const) : ("model-asserted" as const);
  const notes: string[] = [];
  const thrownCases =
    seen === undefined || relation !== null
      ? []
      : caseRows(check, seen).flatMap((row) =>
          row.thrown === null ? [] : [{ case: row.index, in: row.thrown }],
        );
  const verdict = (
    finding: PlannedCheckDecision["finding"],
    reason: string,
    control: PlannedCheckDecision["control"] = null,
    excerpt: string | null = null,
    disagreements: readonly CaseDisagreement[] | null = null,
  ): PlannedCheckDecision => {
    const admitted = finding === "admitted" || finding === "unestablished-control";
    const broken =
      finding === "unjudged" ||
      finding === "did-not-load" ||
      finding === "argument-shape" ||
      finding === "did-not-complete" ||
      finding === "raised-in-program";
    return {
      check: check.id,
      atBase,
      observed: seen?.status ?? "not-run",
      admitted,
      reason,
      basis,
      claimedChanges: claimedChanges(check, seen),
      broken,
      finding,
      control,
      ...(admitted ? controlWords(control, atBase) : { establishes: null, unknown: null }),
      notes,
      disagreements,
      thrown: thrownCases.length === 0 ? null : thrownCases,
      reclassified: context.reclassified,
      excerpt: admitted
        ? null
        : (excerpt ??
          (broken
            ? (seen?.output ?? null)
            : (finding === "expectation-contradicted" || finding === "disagrees-with-base") &&
                seen !== undefined &&
                expected !== null
              ? differingLines(expected, seen.stdout).join("; ")
              : null)),
      record: seen?.record ?? null,
      probeRecord: probe.record,
    };
  };
  if (seen === undefined) return verdict("not-run", "the base run recorded no result for it");
  if (seen.status === "unjudged")
    return verdict(
      "unjudged",
      `it could not be judged on the base${seen.unavailable === null ? "" : `: ${seen.unavailable}`}`,
    );
  if (!seen.completed)
    return verdict(
      seen.exitCode === programDidNotLoad ? "did-not-load" : "did-not-complete",
      atBase === "passes"
        ? "it does not run to completion on the base"
        : remedies["did-not-complete"],
    );
  // One value everywhere: every case's answer the same, or a relation that held at every position,
  // which is what calling the project with undefined each time gives.
  const oneAnswer =
    relation === null ? new Set(answers(seen.stdout)).size <= 1 : seen.status === "accepted";
  const misread = probe.misread ?? [];
  if (misread.length > 0) {
    if (oneAnswer)
      return verdict(
        "argument-shape",
        remedies["argument-shape"],
        null,
        [...describeMisreads(misread), `on the base: ${seen.output}`].join("; "),
      );
    notes.push(
      `${describeMisreads(misread).join(" ")}; the check's own answers vary with its input, so the read is reported and decides nothing`,
    );
  }
  const inProgram = thrownCases.filter((one) => one.in === "check-program").map((one) => one.case);
  const relationRaised = relation === null ? 0 : relationRaisedInProgram(seen.stdout);
  if (inProgram.length > 0 || relationRaised > 0)
    return verdict(
      "raised-in-program",
      `${inProgram.length > 0 ? `case(s) ${inProgram.join(", ")} threw` : `${relationRaised} of its calls threw`} in the check program's own code on the base (the innermost stack frame naming a file is the program's module, not the project's), so ${inProgram.length > 0 ? "they" : "those calls"} recorded no answer to compare: a check reports the project's answer by returning it. That is where the exception was raised, not why: the program may be defective (one applying \`in\` to a string the project returned), or it may have asserted on what the project gave, and which is not established here. Return the project's answer, or a value read from it, instead of throwing, as what it printed on the base shows; the behaviour the check was for stays in the work until a check of it runs`,
    );
  const outside = thrownCases.filter((one) => one.in === "outside-program").map((one) => one.case);
  if (outside.length > 0)
    notes.push(
      `case(s) ${outside.join(", ")} threw outside the check program (in the project or what it calls), which is read as the project's answer there`,
    );
  const unattributed = thrownCases
    .filter((one) => one.in === "unattributed")
    .map((one) => one.case);
  if (unattributed.length > 0)
    notes.push(
      `case(s) ${unattributed.join(", ")} threw where no stack frame names a file, so whether the program or the project threw is not known; read as the base's answer with that uncertainty`,
    );
  // For an input the task names, an expectation that is now the base's answer where an earlier
  // expectation of this requirement disagreed with the base: the launch after D1 declared the task's
  // example again expecting the base's no-link, and the base's behaviour is an observation, not the
  // request. Admitted, it would ask a repair to keep the base's answer for the task's own input.
  const contested = context.contested ?? [];
  const adopted =
    relation !== null || contested.length === 0
      ? []
      : caseRows(check, seen).filter(
          (row) =>
            namedByTask(context.task, row.input) &&
            contested.some(
              (one) =>
                JSON.stringify(one.input) === JSON.stringify(row.input) &&
                one.base === row.expected &&
                one.expected !== row.expected,
            ),
        );
  if (adopted.length > 0) {
    const earlier = (row: (typeof adopted)[number]) =>
      contested.find(
        (one) =>
          JSON.stringify(one.input) === JSON.stringify(row.input) && one.base === row.expected,
      );
    return verdict(
      "adopts-base-answer",
      `for ${adopted
        .map(
          (row) =>
            `case ${row.index} (${inputAsRead(row.input)}, an input the task names) it expects ${row.expected}, which is what the base gave there when ${earlier(row)?.check ?? "an earlier check"} expected ${earlier(row)?.expected ?? "something else"}`,
        )
        .join(
          "; ",
        )}. The base's answer is an observation of the code before the change, not the task's request, and nothing here tells whether the earlier expectation or the base is what the task asks for that input; a check holding the base's answer would ask a repair to keep it. It is refused, and the outcome stays unresolved for the worker: keep the task's outcome for its own input (declared as a change, with the task's words in why, where the base does not give it), or leave that input out`,
    );
  }
  if (atBase === "passes") {
    if (seen.status !== "accepted") {
      const disagreements =
        relation === null ? disagreementsOf(caseRows(check, seen), context.task) : null;
      return verdict(
        "disagrees-with-base",
        `${preserveDisagreement(disagreements ?? [])}${oneAnswer && answers(seen.stdout).length > 1 ? " Every case gave one and the same answer there, which a program that does not reach the project also gives, so check how it builds and calls the project." : ""}`,
        null,
        null,
        disagreements,
      );
    }
    const control =
      relation === null
        ? casesControl(check, seen)
        : { source: "relation-agreement" as const, cases: [] };
    return control === null
      ? verdict("unestablished-control", remedies["unestablished-preserve"])
      : verdict("admitted", "it passes on the base, which keeps the behaviour it checks", control);
  }
  if (atBase === "fails") {
    if (seen.status === "accepted")
      return verdict(
        "does-not-detect",
        "it passes on the base, so it does not detect the requested change",
      );
    if (relation !== null)
      return relationAgreedSomewhere(relation, seen.stdout)
        ? verdict(
            "admitted",
            "it completes on the base with the relation broken somewhere, as a check of the change must",
            { source: "relation-agreement", cases: [] },
          )
        : verdict("unestablished-control", remedies["unestablished-relation"]);
    const rows = caseRows(check, seen);
    const contradicted = rows.filter((row) => row.role === "kept" && !row.agrees);
    if (contradicted.length > 0) {
      const lines = differingLines(expected ?? "", seen.stdout).filter((line) =>
        contradicted.some((row) => line.includes(`line ${row.index} `)),
      );
      return verdict(
        "expectation-contradicted",
        `case(s) ${contradicted.map((row) => row.index).join(", ")} are declared kept (changed: false), so the unchanged base must give their expected results, and it does not: either the task changes them (changed: true, with the task's words in why) or the expectation misreads what the base does`,
        null,
        lines.length > 0
          ? lines.join("; ")
          : differingLines(expected ?? "", seen.stdout).join("; "),
        disagreementsOf(contradicted, context.task),
      );
    }
    // A check first declared as keeping behaviour, now declared as changing it: the planner's own
    // reclassification, which is admitted only where the task itself names each changed input.
    // Otherwise any expectation the base contradicted could be relabelled as a change and drive
    // repair toward an outcome nothing in the task states.
    const unnamed = context.reclassified
      ? rows.filter((row) => row.role === "changed" && !namedByTask(context.task, row.input))
      : [];
    if (unnamed.length > 0)
      return verdict(
        "reclassification-unsupported",
        `it was declared as keeping behaviour, then again as a change, and the task does not name the input of case ${unnamed.map((row) => row.index).join(", ")}: a check is reclassified as a change only for outcomes the task states for inputs it names, so this expectation stays the planner's and the check is refused`,
      );
    const alreadyGiven = rows.filter((row) => row.role === "changed" && row.agrees);
    if (alreadyGiven.length > 0)
      notes.push(
        `case(s) ${alreadyGiven.map((row) => row.index).join(", ")} are declared changed, but the base already gives their expected results; they are read as kept behaviour`,
      );
    const control = casesControl(check, seen);
    if (control !== null)
      return verdict(
        "admitted",
        "it completes on the base with a wrong result where the task changes it, and its kept cases agree",
        control,
      );
    return verdict(
      "unestablished-control",
      rows.some((row) => row.agrees) ? remedies["unestablished-change"] : remedies["no-kept-case"],
    );
  }
  return verdict("unjudged", "it declares no base expectation");
}

function claimedChanges(
  check: GoalContract["checks"][number],
  seen: ObservedCheck | undefined,
): PlannedCheckDecision["claimedChanges"] {
  const expected = expectedStdout(check);
  if (expected === null || seen === undefined || !seen.completed) return null;
  const want = expected.split("\n").filter((line) => line.length > 0);
  const got = seen.stdout.split("\n");
  return { cases: want.filter((line, index) => got[index] !== line).length, of: want.length };
}

/**
 * What the harness does to a fresh checkout of the base before a planned check runs there, in a
 * sentence the planner is given: the install and the repository checks the run is configured
 * with, read from the base as the verifier reads them. The planner then knows whether the build
 * output its program imports will exist, rather than arranging a build inside the check, which
 * is what broke the checks of earlier launches.
 */
export async function describeCheckoutPreparation(input: {
  readonly workspace: string;
  readonly baseCommit: string;
  readonly install: boolean;
  readonly lockfile?: string;
  readonly gateOptions: GateSetOptions;
}): Promise<string> {
  const probe = createGitWorkspaceProbe({
    workspaceRoot: input.workspace,
    baseRef: input.baseCommit,
  });
  const gates = assembleGates(
    await detectProject((path) => probe.readBase(path)),
    input.gateOptions,
  ).flatMap((gate) =>
    gate.source.kind === "command" ? [`${gate.id} (${gate.source.command})`] : [],
  );
  return [
    "Before your checks run, the harness makes a fresh checkout of the unchanged base,",
    input.install
      ? `installs its dependencies${input.lockfile === undefined ? "" : ` from ${input.lockfile}`},`
      : "installs nothing (the run was not given --install),",
    gates.length === 0
      ? "and runs no repository command first."
      : `then runs the repository's checks, ${gates.join(", ")}, so whatever those commands build is in place when your program runs.`,
    "The same preparation runs before every candidate is checked.",
  ].join(" ");
}
