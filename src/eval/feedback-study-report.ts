import type { StudySummary } from "./feedback-study-analysis.ts";

/**
 * The feedback study's page, from its summary and nothing else. Every number here is read off the
 * summary, and every sentence that reads a result is chosen by the registered rule from the
 * family's adjusted p-values: help, harm and insufficient are written by the same code path.
 */
type Json = Record<string, unknown>;

const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? "n/a" : `${(100 * value).toFixed(1)}%`;
const points = (value: number) => `${value >= 0 ? "+" : ""}${(100 * value).toFixed(1)}`;
const minutes = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? "n/a" : (ms / 60_000).toFixed(1);
const known = (value: number | null | undefined) =>
  value === null || value === undefined ? "unknown" : String(Math.round(value));
const counts = (value: unknown) =>
  Object.entries((value ?? {}) as Record<string, number>)
    .map(([key, count]) => `${key} ${count}`)
    .join(", ") || "none";

interface Comparison {
  readonly pairs: number;
  readonly cells: { bothPass: number; onlyFirst: number; onlySecond: number; bothFail: number };
  readonly onlyFirstIds: readonly string[];
  readonly onlySecondIds: readonly string[];
  readonly firstPassRate: number | null;
  readonly secondPassRate: number | null;
  readonly mcnemar: { pValue: number; discordant: number };
  readonly difference: { point: number; lower: number; upper: number };
  readonly excluded: readonly { taskId: string; reason: string }[];
  readonly first: string;
  readonly second: string;
}

function table(comparison: Comparison, adjustedP?: number): string[] {
  const { cells, first, second } = comparison;
  const rows = [
    `| ${first} held-back | ${second} held-back | pairs |`,
    "| --- | --- | --- |",
    `| pass | pass | ${cells.bothPass} |`,
    `| fail | pass | ${cells.onlySecond} |`,
    `| pass | fail | ${cells.onlyFirst} |`,
    `| fail | fail | ${cells.bothFail} |`,
    "",
    `- Pairs: ${comparison.pairs}. Held-back pass rate: ${first} ${percent(comparison.firstPassRate)}, ${second} ${percent(comparison.secondPassRate)}.`,
    `- ${second} passed where ${first} failed: ${cells.onlySecond}${comparison.onlySecondIds.length > 0 ? ` (${comparison.onlySecondIds.join(", ")})` : ""}. ${first} passed where ${second} failed: ${cells.onlyFirst}${comparison.onlyFirstIds.length > 0 ? ` (${comparison.onlyFirstIds.join(", ")})` : ""}.`,
    `- Exact two-sided McNemar over ${comparison.mcnemar.discordant} discordant pair(s): p = ${comparison.mcnemar.pValue.toFixed(4)}${adjustedP === undefined ? "" : `, Holm-adjusted across the primary family ${adjustedP.toFixed(4)}`}.`,
    `- Paired risk difference, ${second} minus ${first}: ${points(comparison.difference.point)} points, 95% Newcombe interval [${points(comparison.difference.lower)}, ${points(comparison.difference.upper)}].`,
  ];
  if (comparison.excluded.length > 0) {
    rows.push(
      `- Not compared, by name: ${comparison.excluded.map((one) => `${one.taskId} (${one.reason})`).join("; ")}.`,
    );
  }
  return rows;
}

function reading(
  entry: { model: string; treatment: string; reading: string; discordant: number },
  fewest: number,
): string {
  if (entry.reading === "supports-help") {
    return `${entry.model}, ${entry.treatment}: under the registered rule the evidence supports ${entry.treatment} feedback raising the held-back pass rate over neutral review.`;
  }
  if (entry.reading === "supports-harm") {
    return `${entry.model}, ${entry.treatment}: under the registered rule the evidence supports ${entry.treatment} feedback lowering the held-back pass rate against neutral review.`;
  }
  return (
    `${entry.model}, ${entry.treatment}: insufficient under the registered rule. ` +
    (entry.discordant < fewest
      ? `${entry.discordant} discordant pair(s); fewer than ${fewest} cannot reach the family-wise 5% whichever way they fall, which is a statement about power and not about the effect.`
      : `${entry.discordant} discordant pair(s), and the adjusted p-value is not below 5%.`)
  );
}

/** What a derivation says about itself, as the page states it. */
export interface StudyDerivationView {
  readonly inPlace: boolean;
  readonly derivedWith: {
    readonly analysis: string;
    readonly renderer: string;
    readonly matchesRegistered: boolean;
    readonly harness: string;
  };
  readonly observations: { readonly results: string; readonly hiddenScores: string | null };
  readonly summaryDigest: string;
  readonly classificationsDigest: string;
  readonly againstPublished: {
    readonly changed: readonly string[];
    readonly added: readonly string[];
    readonly removed: readonly string[];
  } | null;
}

export function renderStudyReport(input: {
  readonly summary: StudySummary;
  readonly parameters: Json;
  readonly environment: Json | null;
  readonly postscript: string | null;
  readonly derivation: StudyDerivationView;
}): string {
  const { summary, parameters, derivation } = input;
  const panel = (parameters.panel ?? []) as Json[];
  const family = summary.primaryFamily;
  const lines: string[] = [
    "# Verification feedback after visible acceptance",
    "",
    "Does a specific mechanical finding, given to an agent after its patch already passes the visible acceptance check and the repository's own checks, change held-back correctness more than the same repair budget spent on a neutral review?",
    "",
    "## Identity",
    "",
    `- Study \`${summary.identity.study}\`, generation ${summary.identity.generation}, protocol digest \`${summary.identity.protocolDigest}\``,
    `- Manifest \`${summary.identity.manifestDigest}\`, acquisition \`${summary.identity.acquisitionDigest}\`, treatment policy \`${String(parameters.policy)}\` \`${summary.identity.policyDigest}\``,
    `- Harness commit of the rows \`${summary.identity.harness}\``,
    `- Derived with analysis \`${derivation.derivedWith.analysis}\` and renderer \`${derivation.derivedWith.renderer}\`, ${derivation.derivedWith.matchesRegistered ? "the ones the protocol registered" : "which differ from the ones the protocol registered; the rows were written under the registered acquisition"}, at \`${derivation.derivedWith.harness}\``,
    `- Data digests: results \`${derivation.observations.results}\`, held-back scores \`${derivation.observations.hiddenScores ?? "none"}\`, summary \`${derivation.summaryDigest}\`, classifications \`${derivation.classificationsDigest}\``,
  ];
  if (!derivation.inPlace && derivation.againstPublished !== null) {
    const against = derivation.againstPublished;
    lines.push(
      `- Against the published summary: values changed ${against.changed.length === 0 ? "none" : against.changed.join(", ")}; fields added ${against.added.length}; removed ${against.removed.length}. The published files stand beside this one, unmodified`,
    );
  }
  lines.push(
    "",
    "### Model panel",
    "",
    "| model | family | endpoint | decoding | thinking | digest |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const entry of panel) {
    lines.push(
      `| \`${String(entry.id)}\` | ${String(entry.family)} | ${String(entry.endpoint)} | ${String(entry.decoding)} | ${String(entry.thinking)} | \`${String(entry.digest).slice(0, 19)}\` |`,
    );
  }
  const agent = parameters.agent as Json;
  const limits = parameters.limits as Json;
  lines.push(
    "",
    `Budget per invocation: ${String(agent.maxWallMinutes)} wall minutes, ${String(agent.maxTokens)} tokens, the agent's default step cap. At most ${String(limits.prefixInvocations)} prefix invocation(s) and ${String(limits.repairInvocations)} repair invocation(s) per arm; a unit interrupted by infrastructure is run again at most ${String(Number(limits.attemptsPerUnit) - 1)} more time(s).`,
  );
  if (input.environment !== null) {
    const machine = (input.environment.machine ?? {}) as Json;
    lines.push(
      `Machine: Node ${String(machine.node)}, ${String(machine.platform)} ${String(machine.release)} ${String(machine.arch)}, ${String(machine.cpu)}, ${String(machine.cores)} cores.`,
    );
  }

  const cohort = summary.cohort;
  lines.push(
    "",
    "## Cohort",
    "",
    `\`${cohort.name}\`: ${cohort.tasks} tasks across ${cohort.repositories} repositories. The largest repository holds ${percent(cohort.largestRepositoryShare)} of the cohort. ${cohort.singleCaseHalf} tasks have a single case on one side of the oracle split.`,
    "",
    `Selection: ${cohort.selection.rule}. ${cohort.selection.setAsideByCap.length} viable task(s) set aside by the cap. Historical repositories above the cap, kept whole: ${cohort.selection.repositoriesOverCap.map((one) => `${one.repository} ${one.tasks}`).join(", ") || "none"}.`,
    "",
    `By repository: ${Object.entries(cohort.byRepository)
      .map(([name, count]) => `${name} ${count}`)
      .join(", ")}.`,
  );

  lines.push("", "## Accounting", "");
  for (const [model, data] of Object.entries(summary.byModel)) {
    const accounting = (data as Json).accounting as Json;
    const prefixCost = accounting.prefixCost as Json;
    const lost = accounting.lostToInfrastructure as Json;
    lines.push(
      `### \`${model}\``,
      "",
      `- Pair status: ${counts(accounting.pairStatus)}.`,
      `- Visibly accepted prefixes: ${String(accounting.visiblyAccepted)}. Eligible pairs: ${String(accounting.eligible)} (reach ${String(accounting.eligibleReach)}, mutation ${String(accounting.eligibleMutation)}, both ${String(accounting.dualTrigger)}).`,
      `- Interrupted and re-run: ${String(accounting.interruptedPrefixAttempts)} prefix attempt(s), ${String(accounting.interruptedArmAttempts)} arm attempt(s); compute lost to them ${String(lost.invocations)} invocation(s), ${minutes(lost.agentWallMs as number)} agent minutes.`,
      `- Invocations: ${String(accounting.invocations)}, of which ${String(accounting.invocationsWithUnknownUsage)} did not report usage. How each invocation's own loop stopped: ${counts(accounting.stopReasons)}.`,
      `- Prefix cost: ${String(prefixCost.invocations)} invocation(s), ${known(prefixCost.modelCalls as number)} model calls, ${known(prefixCost.inputTokens as number)} input and ${known(prefixCost.outputTokens as number)} output tokens, ${minutes(prefixCost.agentWallMs as number)} agent minutes, ${minutes(prefixCost.judgeWallMs as number)} visible-judge minutes. Held-back judging: ${minutes(accounting.heldBackJudgeWallMs as number)} minutes.`,
    );
    const excluded = accounting.excluded as { taskId: string; reason: string }[];
    if (excluded.length > 0) {
      lines.push(
        `- Left out before any comparison, by name: ${excluded.map((one) => `${one.taskId} (${one.reason})`).join("; ")}.`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## Primary: each treatment against neutral review, on its own pairs",
    "",
    `${family.method}. ${family.tests} test(s) in the family. A claim in either direction needs a Holm-adjusted p-value below 5%; with ${family.tests} tests that takes at least ${family.fewestDiscordantForAClaim} discordant pairs all falling one way.`,
    "",
    "| model | treatment | pairs | discordant | p | Holm p | reading |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const entry of family.family) {
    lines.push(
      `| \`${entry.model}\` | ${entry.treatment} | ${entry.pairs} | ${entry.discordant} | ${entry.pValue.toFixed(4)} | ${entry.holmAdjustedP.toFixed(4)} | ${entry.reading} |`,
    );
  }
  lines.push("", "### Readings, by the registered rule", "");
  for (const entry of family.family)
    lines.push(`- ${reading(entry, family.fewestDiscordantForAClaim)}`);
  for (const [model, data] of Object.entries(summary.byModel)) {
    lines.push("", `### \`${model}\``);
    const primary = (data as Json).primary as Record<string, Comparison>;
    for (const [treatment, comparison] of Object.entries(primary)) {
      const adjusted = family.family.find(
        (one) => one.model === model && one.treatment === treatment,
      )?.holmAdjustedP;
      lines.push("", `Neutral review against ${treatment}:`, "", ...table(comparison, adjusted));
    }
  }

  lines.push(
    "",
    "## Pooled across models",
    "",
    `${summary.pooled.method}; ${summary.pooled.bootstrap.resamples} resamples, seed ${summary.pooled.bootstrap.seed}. Descriptive: no pooled test is made, because rows of one task under two models are not independent.`,
    "",
  );
  for (const [treatment, pooled] of Object.entries(summary.pooled.byTreatment)) {
    const value = pooled as Json;
    if (value.computed !== true) {
      lines.push(`- ${treatment}: not computed, ${String(value.reason)}.`);
      continue;
    }
    const difference = value.difference as {
      point: number;
      lower: number;
      upper: number;
      rows: number;
      clusters: number;
    };
    lines.push(
      `- ${treatment}: ${difference.rows} rows over ${difference.clusters} tasks, ${treatment} minus neutral ${points(difference.point)} points, task-clustered 95% interval [${points(difference.lower)}, ${points(difference.upper)}].`,
    );
  }

  lines.push(
    "",
    "## Where both findings existed: ranking the treatments",
    "",
    "Direct comparison of reach, mutation and combined is made only on pairs where both findings existed on the same prefix patch.",
  );
  for (const [model, data] of Object.entries(summary.byModel)) {
    const dual = (data as Json).dualTrigger as Json;
    lines.push("", `### \`${model}\`: ${String(dual.pairs)} dual-trigger pair(s)`);
    for (const key of ["reachVersusMutation", "reachVersusCombined", "mutationVersusCombined"]) {
      const comparison = dual[key] as Comparison;
      lines.push("", `${comparison.first} against ${comparison.second}:`, "", ...table(comparison));
    }
  }

  lines.push(
    "",
    "## From the prefix patch to each arm",
    "",
    "How much of any change came from another review turn and how much from specific verifier information: every arm against the prefix patch it forked from, on the pairs where it ran.",
  );
  for (const [model, data] of Object.entries(summary.byModel)) {
    lines.push("", `### \`${model}\``);
    for (const [arm, comparison] of Object.entries(
      (data as Json).transitionsFromPrefix as Record<string, Comparison>,
    )) {
      const cells = comparison.cells;
      lines.push(
        `- ${arm}: ${comparison.pairs} pair(s); fail to pass ${cells.onlySecond}, pass to fail ${cells.onlyFirst}, pass to pass ${cells.bothPass}, fail to fail ${cells.bothFail}.`,
      );
    }
  }

  lines.push(
    "",
    "## Mechanism",
    "",
    "Clearing a verifier finding is described here and is not a success: held-back correctness is the outcome. A proxy-only success is a finding that cleared on a patch the held-back half refuses. Change classes are rules over paths and the repair sessions' own ledgers; nothing here reads code for meaning.",
  );
  for (const [model, data] of Object.entries(summary.byModel)) {
    lines.push(
      "",
      `### \`${model}\``,
      "",
      "| arm | ran | settled | patch changed | finding cleared | proxy-only | helpful | harmful | unchanged | resolution rate | improvement rate |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    const mechanism = (data as Json).mechanism as Record<string, Json>;
    for (const [arm, entry] of Object.entries(mechanism)) {
      lines.push(
        `| ${arm} | ${String(entry.ran)} | ${String(entry.settled)} | ${String(entry.patchChanged)} | ${String(entry.signalCleared)} | ${String(entry.proxyOnlySuccess)} | ${String(entry.helpfulHiddenTransitions)} | ${String(entry.harmfulHiddenTransitions)} | ${String(entry.unchangedHiddenOutcomes)} | ${percent(entry.verifierResolutionRate as number | null)} | ${percent(entry.hiddenImprovementRate as number | null)} |`,
      );
    }
    lines.push("");
    for (const [arm, entry] of Object.entries(mechanism)) {
      const classes = entry.changeClasses as Json;
      lines.push(
        `- ${arm}: terminal ${counts(entry.byTerminal)}. Finding relation fork to final ${counts(entry.outcomeRelation)}. Test-only changes ${String(classes.testOnly)}, non-runtime-only ${String(classes.nonRuntimeOnly)}, scratch-only ${String(classes.scratchOnly)}. Proxy-only tasks: ${((entry.proxyOnlyTasks ?? []) as string[]).join(", ") || "none"}.`,
      );
    }
    lines.push(
      "",
      "| arm | invocations | model calls | input tokens | output tokens | agent min | judge min | per helpful: invocations | per helpful: agent min |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const [arm, entry] of Object.entries(mechanism)) {
      const cost = entry.cost as Json;
      const per = entry.costPerHelpfulHiddenRepair as Json;
      lines.push(
        `| ${arm} | ${String(cost.invocations)} | ${known(cost.modelCalls as number)} | ${known(cost.inputTokens as number)} | ${known(cost.outputTokens as number)} | ${minutes(cost.agentWallMs as number)} | ${minutes(cost.judgeWallMs as number)} | ${per.invocations === null ? "n/a" : (per.invocations as number).toFixed(1)} | ${minutes(per.agentWallMs as number | null)} |`,
      );
    }
  }

  const blinding = summary.blinding;
  lines.push(
    "",
    "## Keeping the held-back half out of reach",
    "",
    `Every agent session's payloads were searched for paths under the places the held-back half, the mined checkouts or another invocation live. ${blinding.invocationsChecked} invocation(s) were checked and ${blinding.invocationsUnchecked} could not be read. ${blinding.invocationsReferencingHeldBackPlaces === 0 ? "None named such a place." : `${blinding.invocationsReferencingHeldBackPlaces} named one: ${JSON.stringify(blinding.references)}.`}`,
  );

  if (input.postscript !== null) lines.push("", input.postscript.trim());
  lines.push(
    "",
    "## Re-deriving this page",
    "",
    "    node scripts/feedback-study.mjs analyze --out <directory>",
    "",
    "reads the committed rows, calls no model and no judge, and writes this page, `summary.json` and `classifications.json` again.",
    "",
  );
  return lines.join("\n");
}
