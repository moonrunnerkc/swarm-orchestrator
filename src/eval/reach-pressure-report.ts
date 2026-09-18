import type { PairedTableReport, ReachPressureSummary } from "./reach-pressure-analysis.ts";

/**
 * The report, rendered from the summary and nothing else that was measured.
 *
 * Every number on the page is read out of the summary object, so re-deriving the summary from the
 * committed rows re-derives the page. The only prose that is not a function of the numbers is the
 * per-pair notes, which are written after the aggregate exists, committed as data beside the rows,
 * and printed under the pair they describe.
 */
export interface ReportInput {
  readonly summary: ReachPressureSummary;
  readonly parameters: Record<string, unknown>;
  readonly environment: Record<string, unknown> | null;
  /** Task id to what changed between the two patches, stated as diff facts. */
  readonly pairNotes: Readonly<Record<string, string>>;
  readonly digests: {
    /** The driver sources as they stood when this page was derived, against the registered ones. */
    readonly driverAtAnalysis: string;
    readonly results: string;
    readonly hiddenScores: string | null;
    readonly summary: string;
  };
}

const percent = (value: number) => `${value.toFixed(1)}%`;
const signed = (value: number) => `${value >= 0 ? "+" : ""}${(100 * value).toFixed(1)}`;
const orUnknown = (value: unknown) =>
  value === null || value === undefined ? "unknown" : String(value);

function tableOf(table: PairedTableReport): string[] {
  const { cells, percentages } = table;
  const row = (control: string, reach: string, reading: string, key: keyof typeof cells) =>
    `| ${control} | ${reach} | ${reading} | ${cells[key]} | ${percent(percentages[key])} |`;
  return [
    `Denominator: ${table.pairs} ${table.denominator}.`,
    "",
    "| control held-back result | reach held-back result | reading | tasks | share |",
    "| --- | --- | --- | --- | --- |",
    row("pass", "pass", "no correctness change", "passPass"),
    row("fail", "pass", "reach helped", "failPass"),
    row("pass", "fail", "reach hurt", "passFail"),
    row("fail", "fail", "neither condition completed the held-back behaviour", "failFail"),
  ];
}

function statisticsOf(table: PairedTableReport): string[] {
  const { mcnemar, difference } = table;
  return [
    `- Held-back pass rate: control ${table.controlPassRate === null ? "n/a" : percent(100 * table.controlPassRate)}, ` +
      `reach ${table.reachPassRate === null ? "n/a" : percent(100 * table.reachPassRate)}.`,
    `- Harm count (control pass, reach fail): ${mcnemar.onlyFirst}. Help count (control fail, reach pass): ${mcnemar.onlySecond}.`,
    `- Exact two-sided McNemar over ${mcnemar.discordant} discordant pair(s): p = ${mcnemar.pValue.toFixed(4)} (\`${mcnemar.method}\`).`,
    `- Paired difference in held-back pass rate, reach minus control: ${signed(difference.point)} points, ` +
      `95% CI [${signed(difference.lower)}, ${signed(difference.upper)}] over ${difference.pairs} pair(s) (\`${difference.method}\`).`,
  ];
}

function readingOf(summary: ReachPressureSummary): string[] {
  const { primary } = summary;
  const few =
    primary.mcnemar.discordant < 6
      ? `With ${primary.mcnemar.discordant} discordant pair(s) the exact test cannot reach 5% whichever way ` +
        "they fall, so this cohort cannot support a population claim in either direction. That is a " +
        "statement about power and not about the effect."
      : "";
  const direction =
    summary.populationReading === "supports-harm"
      ? "Under the predeclared rule the evidence supports a population-level harm: reach enforcement lowered the held-back pass rate in this corpus with this model."
      : summary.populationReading === "supports-help"
        ? "Under the predeclared rule the evidence contradicts a population-level harm: reach enforcement raised the held-back pass rate in this corpus with this model."
        : "Under the predeclared rule the evidence is insufficient for a population-level claim that reach enforcement raises or lowers the held-back pass rate in this corpus with this model.";
  const instances =
    primary.harm.length > 0
      ? `At the level of single tasks, ${primary.harm.length} pair(s) show the harmful direction occurring: ` +
        "the control patch passed the held-back oracle and the patch produced under reach feedback did not. " +
        "That establishes that it can happen here, and says nothing about how often."
      : "No pair shows the harmful direction, so this run does not show that it can happen here. It does not show that it cannot.";
  return [direction, few, instances].filter((line) => line.length > 0);
}

export function renderReport(input: ReportInput): string {
  const { summary, parameters, environment, pairNotes, digests } = input;
  const { identity, cohort, accounting, primary, subsets, secondary } = summary;
  const repositories = Object.entries(cohort.byRepository).sort(
    ([, left], [, right]) => right - left,
  );
  const topThree = repositories.slice(0, 3).reduce((total, [, tasks]) => total + tasks, 0);
  const limits = parameters.limits as Record<string, unknown> | undefined;
  const agent = parameters.agent as Record<string, unknown> | undefined;
  const overhead = secondary.overhead as {
    triggeredTasks: number;
    prefix: Record<string, number | null>;
    reachRepair: Record<string, number | null>;
  };
  const minutes = (ms: number | null | undefined) =>
    ms === null || ms === undefined ? "unknown" : (ms / 60_000).toFixed(1);
  const patchLink = (digest: unknown) =>
    `[\`${String(digest).slice(7, 19)}\`](patches/${String(digest).slice(7)}.patch)`;

  const lines: string[] = [
    "# Reach pressure: does enforcing changed-line reach change held-back correctness?",
    "",
    "## Identity",
    "",
    `- Protocol generation ${identity.generation}, protocol digest \`${identity.protocolDigest}\``,
    `- Manifest digest \`${identity.manifestDigest}\``,
    `- Experiment driver digest \`${identity.driverDigest}\`, policy digest \`${identity.policyDigest}\``,
    digests.driverAtAnalysis === identity.driverDigest
      ? "- This page was derived with the driver sources the protocol registered"
      : `- This page was derived with driver sources \`${digests.driverAtAnalysis}\`, which differ from the registered ones. The rows were written under the registered driver`,
    `- Harness commit \`${identity.harness}\``,
    `- Model \`${orUnknown(parameters.model)}\` at \`${orUnknown(parameters.endpoint)}\`; no sampling parameters are sent, so the server's defaults decide decoding (see the protocol)`,
    `- Agent budget per invocation: ${orUnknown(agent?.maxWallMinutes)} wall minutes, ${orUnknown(agent?.maxTokens)} tokens; ` +
      `at most ${orUnknown(limits?.prefixInvocations)} invocation(s) before visible acceptance and ${orUnknown(limits?.reachRepairInvocations)} reach repair invocation(s) after it`,
    `- Environment: ${environment === null ? "not recorded" : `Node ${orUnknown(environment.node)}, ${orUnknown(environment.platform)} ${orUnknown(environment.release)} ${orUnknown(environment.arch)}, ${orUnknown(environment.cpu)}, ${orUnknown(environment.cores)} cores`}`,
    `- Data digests: results \`${digests.results}\`, held-back scores \`${orUnknown(digests.hiddenScores)}\`, summary \`${digests.summary}\``,
    "",
    "## Accounting",
    "",
    `- Cohort \`${cohort.name}\`. Frozen tasks: ${orUnknown(accounting.frozenTasks)}; settled: ${orUnknown(accounting.settledTasks)}; interrupted attempts kept on the ledger: ${orUnknown(accounting.interruptedAttempts)}`,
    `- Terminal statuses: ${Object.entries(accounting.byStatus as Record<string, number>)
      .map(([status, tasks]) => `${status} ${tasks}`)
      .join(", ")}`,
    `- Judgeable pairs (both patches carry a held-back pass or fail): ${orUnknown(accounting.judgeablePairs)}`,
    `- Tasks that reached visible acceptance: ${orUnknown(accounting.visibleAccepted)}`,
    `- Of those, tasks where reach was measured at acceptance: ${orUnknown(accounting.reachMeasuredAtAcceptance)}`,
    `- Tasks where reach triggered (accepted, and the visible oracle never ran an added line): ${orUnknown(accounting.reachTriggered)}; ` +
      `repaired to satisfy reach: ${orUnknown(accounting.reachRepaired)}; repair budget exhausted: ${orUnknown(accounting.reachRepairExhausted)}`,
    `- Agent invocations: ${orUnknown(accounting.agentInvocations)}, of which ${orUnknown(accounting.invocationsWithUnknownUsage)} did not report usage`,
    "",
    "## Primary outcome",
    "",
    ...tableOf(primary),
    "",
    ...statisticsOf(primary),
    "",
    "## Reading",
    "",
    ...readingOf(summary).flatMap((line) => [line, ""]),
    "## The same table over narrower denominators",
    "",
    "Pairs outside the fork are one patch scored once, so they are concordant by construction. These",
    "subsets show the effect conditional on the treatment having been possible.",
    "",
  ];
  for (const subset of [subsets.visibleAccepted, subsets.reachTriggered, subsets.reachRepaired]) {
    lines.push(...tableOf(subset), "", ...statisticsOf(subset), "");
  }
  lines.push(
    "## Secondary: a pass that also requires the repository's own checks to pass",
    "",
    ...tableOf(secondary.heldBackPassAndRegressionPass as PairedTableReport),
    "",
    ...statisticsOf(secondary.heldBackPassAndRegressionPass as PairedTableReport),
    "",
    "## Where reach triggered",
    "",
  );
  if (summary.triggered.length === 0) {
    lines.push("Reach triggered on no task, so there is no repair to describe.", "");
  } else {
    lines.push(
      "| task | status | repairs | control patch | reach patch | executable added lines | files | test lines added | visible after | regression after | held-back control / reach | bond control / reach |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const one of summary.triggered) {
      const before = one.controlMetrics as Record<string, number> | null;
      const after = one.reachMetrics as Record<string, number> | null;
      const visible = one.visible as { reach: Record<string, string> };
      const hidden = one.hidden as Record<string, string | null>;
      const bond = one.bond as Record<string, string>;
      lines.push(
        `| ${one.taskId} | ${one.status} | ${one.repairs} | ${patchLink(one.controlPatch)} | ` +
          `${one.patchChanged ? patchLink(one.reachPatch) : "unchanged"} | ` +
          `${before?.executableAddedLines ?? "?"} to ${after?.executableAddedLines ?? "?"} | ` +
          `${before?.filesChanged ?? "?"} to ${after?.filesChanged ?? "?"} | ` +
          `${before?.testAddedLines ?? "?"} to ${after?.testAddedLines ?? "?"} | ` +
          `${visible.reach.task}, reach ${visible.reach.oracleReach} | ${visible.reach.regression} | ` +
          `${orUnknown(hidden.control)} / ${orUnknown(hidden.reach)} | ${bond.control} / ${bond.reach} |`,
      );
    }
    const noted = summary.triggered
      .map((one) => ({ id: String(one.taskId), note: pairNotes[String(one.taskId)] }))
      .filter((one): one is { id: string; note: string } => one.note !== undefined);
    if (noted.length > 0) {
      lines.push("", "What each repair did, as diff facts:", "");
      for (const one of noted) lines.push(`- **${one.id}**: ${one.note}`);
    }
    const direction = secondary.repairDirection as Record<string, Record<string, number>>;
    lines.push(
      "",
      "Direction of the repair across those tasks, reach patch against control patch:",
      "",
      "| measure | decreased | unchanged | increased |",
      "| --- | --- | --- | --- |",
      ...Object.entries(direction).map(
        ([measure, signs]) =>
          `| ${measure} | ${signs.decreased} | ${signs.unchanged} | ${signs.increased} |`,
      ),
      "",
      "No branch or condition count is reported: nothing in this repository parses the mined",
      "projects' languages, and a pattern over text would be a guess.",
      "",
      "### What reach enforcement cost",
      "",
      `Over the ${overhead.triggeredTasks} task(s) where it triggered, the repair phase added ` +
        `${orUnknown(overhead.reachRepair.invocations)} agent invocation(s), ${minutes(overhead.reachRepair.agentWallMs)} agent minutes, ` +
        `${minutes(overhead.reachRepair.judgeWallMs)} judging minutes, ${orUnknown(overhead.reachRepair.modelCalls)} model call(s), ` +
        `${orUnknown(overhead.reachRepair.inputTokens)} input and ${orUnknown(overhead.reachRepair.outputTokens)} output tokens. ` +
        `The shared prefix of the same tasks took ${orUnknown(overhead.prefix.invocations)} invocation(s), ${minutes(overhead.prefix.agentWallMs)} agent minutes, ` +
        `${orUnknown(overhead.prefix.modelCalls)} model call(s), ${orUnknown(overhead.prefix.inputTokens)} input and ${orUnknown(overhead.prefix.outputTokens)} output tokens. ` +
        "A token total reads unknown where any invocation in it did not report usage.",
      "",
    );
  }
  const bondStates = secondary.bondAtVisibleAcceptedTasks as Record<string, Record<string, number>>;
  lines.push(
    "## Oracle bond, recorded and enforced by neither condition",
    "",
    ...(["control", "reach"] as const).map(
      (arm) =>
        `- ${arm} patches of visible-accepted tasks: ${
          Object.entries(bondStates[arm] ?? {})
            .map(([state, tasks]) => `${state} ${tasks}`)
            .join(", ") || "none"
        }`,
    ),
    "",
    "## Discordant pairs",
    "",
  );
  for (const [heading, ids] of [
    ["Harmful (control pass, reach fail)", primary.harm],
    ["Helpful (control fail, reach pass)", primary.help],
  ] as const) {
    lines.push(`### ${heading}`, "");
    if (ids.length === 0) lines.push("None.", "");
    for (const id of ids) {
      const one = summary.triggered.find((entry) => entry.taskId === id);
      lines.push(
        `- **${id}**: control ${one === undefined ? "?" : patchLink(one.controlPatch)}, reach ${one === undefined ? "?" : patchLink(one.reachPatch)}. ` +
          (pairNotes[id] ?? "No note has been written for this pair."),
        "",
      );
    }
  }
  lines.push("## Left out of the paired denominator, by name", "");
  if (summary.excluded.length === 0) lines.push("Nothing was left out.", "");
  for (const one of summary.excluded) lines.push(`- ${one.taskId}: ${one.reason}`);
  if (summary.excluded.length > 0) lines.push("");
  lines.push(
    "## Limitations",
    "",
    "- **One model.** Every trajectory is one local model under one agent loop. How a model answers a reach refusal, by deleting the lines or by making them run, is a property of the model, and nothing here says another would answer the same way.",
    "- **How the corpus was built.** The tasks are merged pull requests that survived a viability filter which admits only what it can install and run offline, so the cohort skews toward small libraries with fast unit tests.",
    `- **The two oracles are halves of one suite.** One author wrote both in one sitting, so they can share a blind spot, and ${cohort.singleCaseHalf} of the ${cohort.tasks} splits hold a single case on one side. A held-back fail from a one-case half is thin evidence of incompleteness.`,
    `- **Task families are concentrated.** ${repositories.length} repositories supply the ${cohort.tasks} tasks and the largest three supply ${topThree}, so pairs are not independent draws and the interval, which treats them as such, is narrower than the truth.`,
    "- **Decoding.** No sampling parameters are sent and the server decodes greedily by default, so there is one trajectory per task and no estimate of run-to-run variance. Batched GPU inference is not bit-reproducible, so a rerun may differ.",
    "- **The agent cannot see the visible oracle.** Reach feedback names unexecuted lines, and the only moves open to the agent are to change its own code. A setting where the agent may extend the tests would exert a different pressure.",
    "- **Feedback travels as task text.** Repair invocations are fresh conversations that read the task and the verifier's observations in the prompt, which is how this harness repairs, and not a continuation of the earlier conversation.",
    "- **What the workspace guard is.** The held-back half is kept out of the workspace, its git objects and every prompt. The tool policy is lexical and an allowed interpreter can still read outside the workspace, which no transcript here was audited for.",
    "- **Reach is only as good as its coverage reading.** A transforming runner can make reach read unmeasured, and those tasks cannot trigger the treatment.",
    "",
    "## Re-deriving this page",
    "",
    "    node scripts/reach-pressure-experiment.mjs analyze",
    "",
    "reads the committed rows, calls no model and no judge, and writes this file and `summary.json` again.",
    "",
  );
  return lines.join("\n");
}
