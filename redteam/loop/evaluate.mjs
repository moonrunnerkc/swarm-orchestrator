/**
 * Pure routing logic for the red-team fix/attack loop.
 *
 * Nothing here touches the filesystem, git, or a child process: the driver does the IO and
 * hands the parsed rows, plus what it resolved on disk, to these functions.
 *
 * Result and residual status are the agents' words and this module takes them as given. Two
 * things it does not take on trust, because the loop routes off them and an agent's own report
 * is the one thing that cannot vouch for itself:
 *
 * - A succeeded row is worth nothing without the artifacts it cites. A row that names no
 *   regression test or golden case, or names one the recorded branch does not carry, is
 *   UNVERIFIED: it is not counted as a finding and it stops the lap for a human.
 * - Severity is not re-derived in general, which would mean judging the finding, but where the
 *   schema fixes it by part it is read from the part rather than the stated field. See
 *   effectiveSeverity.
 *
 * Contracts for the two row shapes live in redteam/loop/report-schema.md.
 */

/** Severity order the fixer prompt wants findings in. Anything unrecognised sorts last. */
export const SEVERITY_ORDER = ["trust-root", "mechanical", "doc", "residual"];

export const DECISION = {
  converged: "CONVERGED",
  wake: "WAKE-HUMAN",
  continue: "CONTINUE",
};

/**
 * Parts the schema defines as trust-root: a success here can make a green bundle misrepresent
 * reality, so the part decides the severity and the attacker's own label does not get a vote.
 */
export const TRUST_ROOT_PARTS = [
  "claims",
  "ledger",
  "evidence",
  "coverage",
  "scrub",
  "scrub-into-bundle",
  "base-control",
];

/**
 * Parts where "mechanical" is a claim the harness will honor, because a success there cannot
 * forge a verdict. Anything outside both lists that still calls itself mechanical is escalated:
 * the loop cannot check the claim, and an unbacked downgrade is the failure this guards.
 */
export const MECHANICAL_ELIGIBLE_PARTS = ["markers", "derivation"];

export function severityRank(severity) {
  const index = SEVERITY_ORDER.indexOf(String(severity ?? ""));
  return index === -1 ? SEVERITY_ORDER.length : index;
}

function normalizeToken(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * A citation the harness can go looking for, or null.
 *
 * The JSON null, the empty string, and the words a model writes when it means "nothing here"
 * are all absence. Treating "null" as a path would send the driver hunting for a file by that
 * name and report it missing, which reads as a broken path rather than an uncited row.
 */
export function normalizeCitation(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "" || ["null", "none", "n/a", "undefined"].includes(trimmed.toLowerCase())) {
    return null;
  }
  return trimmed;
}

/**
 * The severity the loop routes on, which is the part's severity wherever the schema fixes it.
 *
 * Severity in general cannot be re-derived without judging the finding, so this does only the
 * bounded part: a row's `part` already names the trust root it attacked, and the schema already
 * says those parts are trust-root. Where the part decides, the stated field is ignored.
 */
export function effectiveSeverity(row) {
  const part = normalizeToken(row?.part);
  const stated = normalizeToken(row?.severity);
  if (TRUST_ROOT_PARTS.includes(part)) return "trust-root";
  if (stated === "mechanical" && !MECHANICAL_ELIGIBLE_PARTS.includes(part)) return "trust-root";
  return stated === "" ? "unknown" : stated;
}

/** Rows whose stated severity the part overrode, so the summary can name the relabelling. */
export function severityDiscrepancies(rows) {
  const found = [];
  for (const row of rows ?? []) {
    const stated = normalizeToken(row?.severity) || "unstated";
    const effective = effectiveSeverity(row);
    if (stated === effective) continue;
    const part = normalizeToken(row?.part) || "(no part)";
    const reason = TRUST_ROOT_PARTS.includes(part)
      ? `part ${part} is trust-root by the schema`
      : `part ${part} is not one where mechanical can be honored`;
    found.push({ id: String(row?.id ?? "?"), part, stated, effective, reason });
  }
  return found;
}

/**
 * Whether one succeeded row is backed by the artifacts it cites.
 *
 * Two of the three checks are pure reads of the row, so they run everywhere, including a dry run
 * with no git. Resolving the path against a branch needs IO the driver does, and when it has not
 * been done the row is not called backed or unbacked on that clause: `pathChecked` says which.
 */
export function classifyRowBacking(row, backing = {}) {
  const reasons = [];
  const regressionTest = normalizeCitation(row?.regression_test);
  const goldenCase = normalizeCitation(row?.golden_case);
  if (regressionTest === null) reasons.push("regression_test is null");
  if (goldenCase === null) reasons.push("golden_case is null");

  const pathChecked = Boolean(backing.checked);
  if (regressionTest !== null && pathChecked) {
    const present = new Set(backing.presentPaths ?? []);
    if (!present.has(regressionTest)) {
      reasons.push(`regression_test ${regressionTest} is not on ${backing.branch ?? "the recorded branch"}`);
    }
  }
  return {
    id: String(row?.id ?? "?"),
    regressionTest,
    goldenCase,
    pathChecked,
    reasons,
    verified: reasons.length === 0,
  };
}

/**
 * Parse a JSONL body. Blank lines are skipped; a line that does not parse is reported rather
 * than thrown, so one malformed row cannot hide the rest of a report from the human.
 */
export function parseJsonl(text) {
  const rows = [];
  const errors = [];
  const lines = String(text ?? "").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === "") continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        errors.push({ line: index + 1, text: line, message: "not a JSON object" });
        continue;
      }
      rows.push(parsed);
    } catch (error) {
      errors.push({ line: index + 1, text: line, message: error.message });
    }
  }
  return { rows, errors };
}

const FENCE_PATTERN = /^[ \t]*```([^\n`]*)\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;

function everyLineIsJson(body) {
  const lines = body.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return false;
  return lines.every((line) => {
    try {
      const parsed = JSON.parse(line.trim());
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
    } catch {
      return false;
    }
  });
}

/**
 * Pull the trailing report block out of an agent's response.
 *
 * A ```jsonl fence is the contract, and the last one wins because the schema says the block is
 * the last thing in the response. The fallback (last fence whose every line is a JSON object)
 * exists because agents drift on the info string, not to accept a different shape: a fence that
 * is not line-delimited JSON is never taken.
 */
export function extractTrailingJsonlBlock(text) {
  const source = String(text ?? "");
  const labelled = [];
  const jsonShaped = [];
  FENCE_PATTERN.lastIndex = 0;
  let match = FENCE_PATTERN.exec(source);
  while (match !== null) {
    const language = match[1].trim().toLowerCase();
    const body = match[2];
    if (language === "jsonl") labelled.push(body);
    else if (everyLineIsJson(body)) jsonShaped.push(body);
    match = FENCE_PATTERN.exec(source);
  }
  if (labelled.length > 0) return labelled[labelled.length - 1];
  if (jsonShaped.length > 0) return jsonShaped[jsonShaped.length - 1];
  return null;
}

/**
 * Reduce `claude --output-format stream-json` stdout to the assistant's final text.
 *
 * The result event carries the whole final message, so it is preferred; concatenated assistant
 * text blocks are the fallback for a stream that ended without one. Stdout that contains no
 * parseable JSON line at all is returned unchanged, which is what a plain-text CLI emits.
 */
export function collectStreamJsonText(stdout) {
  const source = String(stdout ?? "");
  let sawJsonLine = false;
  let resultText = null;
  const assistantText = [];
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || !(line.startsWith("{") || line.startsWith("["))) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    sawJsonLine = true;
    if (event === null || typeof event !== "object") continue;
    if (event.type === "result" && typeof event.result === "string") {
      resultText = event.result;
      continue;
    }
    const content = event?.message?.content;
    if (event.type === "assistant" && Array.isArray(content)) {
      for (const part of content) {
        if (part?.type === "text" && typeof part.text === "string") assistantText.push(part.text);
      }
    }
  }
  if (!sawJsonLine) return source;
  if (resultText !== null) return resultText;
  return assistantText.join("");
}

/** Full path from raw agent stdout to parsed rows, for either agent. */
export function parseAgentReport(stdout, { streamJson = false } = {}) {
  const text = streamJson ? collectStreamJsonText(stdout) : String(stdout ?? "");
  const block = extractTrailingJsonlBlock(text);
  if (block === null) return { rows: [], errors: [], block: null, text };
  const { rows, errors } = parseJsonl(block);
  return { rows, errors, block, text };
}

export function succeededFindings(attackerRows) {
  return attackerRows.filter((row) => row.result === "succeeded");
}

/** The residual set the driver diffs across laps: ids of rows the attacker marked residual-holds. */
export function residualHoldIds(attackerRows) {
  const ids = attackerRows
    .filter((row) => row.result === "residual-holds")
    .map((row) => String(row.id ?? ""))
    .filter((id) => id !== "");
  return [...new Set(ids)].sort();
}

/** Severity-first, on the routed severity: a mislabelled trust root sorts where it belongs. */
export function sortFindingsBySeverity(rows) {
  return [...rows].sort((left, right) => {
    const bySeverity = severityRank(effectiveSeverity(left)) - severityRank(effectiveSeverity(right));
    if (bySeverity !== 0) return bySeverity;
    return String(left.id ?? "").localeCompare(String(right.id ?? ""));
  });
}

/** Body for {{FINDINGS}} in fixer-prompt.md: severity-first, one "id: mechanism (evidence)" per line. */
export function formatFindingsForPrompt(succeededRows) {
  return sortFindingsBySeverity(succeededRows)
    .map((row) => {
      const id = String(row.id ?? "(no id)");
      const mechanism = String(row.mechanism ?? "(no mechanism)");
      const evidence = String(row.evidence ?? "(no evidence)");
      return `${id}: ${mechanism} (${evidence})`;
    })
    .join("\n");
}

const NO_FIX_PASS_FOCUS =
  "No fix pass ran before this lap, so nothing is newly changed. Sweep every trust root named below.";

/** Body for {{FOCUS}} in attacker-prompt.md: what the fixer just changed, from its own rows. */
export function formatFocusFromFixerItems(fixerRows) {
  if (!Array.isArray(fixerRows) || fixerRows.length === 0) return NO_FIX_PASS_FOCUS;
  const lines = fixerRows.map((row) => {
    const item = String(row.item ?? "?");
    const addresses = Array.isArray(row.addresses) ? row.addresses.join(", ") : "";
    const approach = String(row.approach ?? "(no approach stated)");
    const files = Array.isArray(row.files) ? row.files.join(", ") : "";
    const target = addresses === "" ? "" : ` (closes ${addresses})`;
    const touched = files === "" ? "" : ` [files: ${files}]`;
    return `- item ${item}${target}: ${approach}${touched}`;
  });
  return `The last fix pass changed the following; attack the machinery it created:\n${lines.join("\n")}`;
}

export function diffIdSets(priorIds, currentIds) {
  const prior = new Set(priorIds ?? []);
  const current = new Set(currentIds ?? []);
  const added = [...current].filter((id) => !prior.has(id)).sort();
  const removed = [...prior].filter((id) => !current.has(id)).sort();
  return { added, removed, changed: added.length > 0 || removed.length > 0 };
}

/**
 * Read a fixer row's residual_delta against the schema grammar: none | added:... | removed:...
 *
 * "Unexplained" is the shape the driver can see: a field that is missing, empty, or not one of
 * the three declared forms. A well-formed added:/removed: value is an explained change, and it
 * still routes to WAKE-HUMAN through the residual-set-changed rule, because the fixer declaring
 * a residual move is the same event as the set moving.
 */
export function classifyResidualDelta(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return { kind: "unexplained", reason: "residual_delta missing or empty", detail: null };
  }
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === "none") return { kind: "none", reason: null, detail: null };
  const added = /^added:\s*(\S.*)$/i.exec(trimmed);
  if (added) return { kind: "added", reason: null, detail: added[1].trim() };
  const removed = /^removed:\s*(\S.*)$/i.exec(trimmed);
  if (removed) return { kind: "removed", reason: null, detail: removed[1].trim() };
  return {
    kind: "unexplained",
    reason: `residual_delta does not match none | added:... | removed:...: ${trimmed}`,
    detail: null,
  };
}

export function revertedPriorFixes(fixerRows) {
  return fixerRows
    .filter((row) => {
      const value = row.reverted_prior_fix;
      return typeof value === "string" && value.trim() !== "" && value.trim().toLowerCase() !== "null";
    })
    .map((row) => ({ item: String(row.item ?? "?"), commit: String(row.reverted_prior_fix).trim() }));
}

/** Vitest tail: "Tests  840 passed (840)" or "Tests  838 passed | 2 failed (840)". */
export function parseVitestCounts(gatesOutput) {
  const text = String(gatesOutput ?? "");
  const testLine = [...text.matchAll(/^\s*Tests\s+(.+)$/gm)].at(-1);
  const fileLine = [...text.matchAll(/^\s*Test Files\s+(.+)$/gm)].at(-1);
  const readPassed = (line) => {
    if (!line) return null;
    const passed = /(\d+)\s+passed/.exec(line[1]);
    return passed ? Number(passed[1]) : null;
  };
  const readFailed = (line) => {
    if (!line) return 0;
    const failed = /(\d+)\s+failed/.exec(line[1]);
    return failed ? Number(failed[1]) : 0;
  };
  return {
    testsPassed: readPassed(testLine),
    testsFailed: readFailed(testLine),
    filesPassed: readPassed(fileLine),
  };
}

/**
 * Route one lap.
 *
 * Precedence is WAKE-HUMAN first, then CONVERGED, then CONTINUE. The two can both be satisfiable
 * on the same lap (a quiet attacker report alongside a fixer row that names a reverted_prior_fix),
 * and stopping for a human is the safe half of that pair.
 *
 * `priorResidualIds` of null means there is no prior lap. A set cannot have changed from a lap
 * that never ran, so lap 1 neither wakes nor is blocked from converging on that clause. Same for
 * a null `priorTestCount`.
 *
 * `reportProblems` carries IO-level failures the driver hit reading a report (no JSONL block, a
 * malformed line, an agent that timed out). They route here rather than in the driver so that a
 * report the driver could not read can never be scored as a quiet lap.
 *
 * `artifactBacking` is what the driver resolved on disk: which cited regression-test paths exist
 * on `attackerBranch`, the branch that actually took the attacker's commits. `checked: false`
 * means no branch was consulted (a dry run), which is reported as unchecked rather than passed.
 */
export function evaluateLap({
  lap,
  attackerRows = [],
  fixerRows = [],
  priorResidualIds = null,
  gates = { passed: false, testsPassed: null },
  priorTestCount = null,
  reportProblems = [],
  artifactBacking = { checked: false, branch: null, presentPaths: [] },
  attackerBranch = null,
}) {
  const succeeded = succeededFindings(attackerRows);
  const currentResidualIds = residualHoldIds(attackerRows);
  const residualDiff =
    priorResidualIds === null
      ? { added: [], removed: [], changed: false, baseline: true }
      : { ...diffIdSets(priorResidualIds, currentResidualIds), baseline: false };

  // A claim of a finding with no artifact behind it is not a finding. Unbacked rows are held
  // apart from the counts so they can never be scored as work the fixer could pick up.
  const backings = succeeded.map((row) => ({ row, ...classifyRowBacking(row, artifactBacking) }));
  const unbacked = backings.filter((entry) => !entry.verified);
  const verifiedSucceeded = backings.filter((entry) => entry.verified).map((entry) => entry.row);

  const discrepancies = severityDiscrepancies(succeeded);
  const trustRootSuccesses = verifiedSucceeded.filter((row) => effectiveSeverity(row) === "trust-root");
  const reverts = revertedPriorFixes(fixerRows);

  const residualDeltas = fixerRows.map((row) => ({
    item: String(row.item ?? "?"),
    raw: row.residual_delta,
    ...classifyResidualDelta(row.residual_delta),
  }));
  const unexplainedDeltas = residualDeltas.filter((entry) => entry.kind === "unexplained");
  const declaredDeltas = residualDeltas.filter(
    (entry) => entry.kind === "added" || entry.kind === "removed",
  );

  const testsPassed = gates?.testsPassed ?? null;
  const testCountDropped =
    priorTestCount !== null && testsPassed !== null && testsPassed < priorTestCount;

  const wakeReasons = [];
  if (trustRootSuccesses.length > 0) {
    wakeReasons.push(
      `attacker succeeded at trust-root severity: ${trustRootSuccesses.map((row) => row.id).join(", ")}`,
    );
  }
  if (unbacked.length > 0) {
    wakeReasons.push(
      `succeeded row(s) not backed by the artifacts they cite: ${unbacked
        .map((entry) => `${entry.id} (${entry.reasons.join("; ")})`)
        .join("; ")}`,
    );
  }
  if (reverts.length > 0) {
    wakeReasons.push(
      `fixer backed out a prior fix: ${reverts.map((entry) => `item ${entry.item} reverts ${entry.commit}`).join("; ")}`,
    );
  }
  if (residualDiff.changed) {
    const parts = [];
    if (residualDiff.added.length > 0) parts.push(`added ${residualDiff.added.join(", ")}`);
    if (residualDiff.removed.length > 0) parts.push(`removed ${residualDiff.removed.join(", ")}`);
    wakeReasons.push(`residual set changed: ${parts.join("; ")}`);
  }
  if (declaredDeltas.length > 0) {
    wakeReasons.push(
      `fixer declared a residual change: ${declaredDeltas.map((entry) => `item ${entry.item} ${entry.raw}`).join("; ")}`,
    );
  }
  if (!gates?.passed) {
    wakeReasons.push("gates failed");
  }
  for (const problem of reportProblems) {
    wakeReasons.push(`report unreadable: ${problem}`);
  }

  const convergeBlockers = [];
  for (const problem of reportProblems) {
    convergeBlockers.push(`report unreadable: ${problem}`);
  }
  if (verifiedSucceeded.length > 0) {
    convergeBlockers.push(`attacker has ${verifiedSucceeded.length} succeeded row(s)`);
  }
  if (unbacked.length > 0) {
    convergeBlockers.push(
      `${unbacked.length} succeeded row(s) unverified: ${unbacked.map((entry) => entry.id).join(", ")}`,
    );
  }
  if (residualDiff.changed) convergeBlockers.push("residual set changed");
  if (!gates?.passed) convergeBlockers.push("gates failed");
  if (testCountDropped) {
    convergeBlockers.push(`passing test count fell from ${priorTestCount} to ${testsPassed}`);
  }
  if (unexplainedDeltas.length > 0) {
    convergeBlockers.push(
      `unexplained residual_delta: ${unexplainedDeltas.map((entry) => `item ${entry.item} (${entry.reason})`).join("; ")}`,
    );
  }

  let decision;
  if (wakeReasons.length > 0) decision = DECISION.wake;
  else if (convergeBlockers.length === 0) decision = DECISION.converged;
  else decision = DECISION.continue;

  return {
    lap,
    decision,
    wakeReasons,
    convergeBlockers,
    succeeded,
    verifiedSucceeded,
    unbacked,
    backings,
    artifactBacking,
    attackerBranch,
    severityDiscrepancies: discrepancies,
    successesBySeverity: countBySeverity(verifiedSucceeded),
    residualIds: currentResidualIds,
    residualDiff,
    residualDeltas,
    reverts,
    reportProblems,
    gates: { passed: Boolean(gates?.passed), testsPassed },
    priorTestCount,
    testCountDropped,
  };
}

export function countBySeverity(rows) {
  const counts = {};
  for (const row of rows) {
    const severity = effectiveSeverity(row);
    counts[severity] = (counts[severity] ?? 0) + 1;
  }
  return counts;
}

function formatSeverityCounts(counts) {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "none";
  return entries
    .sort((left, right) => severityRank(left[0]) - severityRank(right[0]))
    .map(([severity, count]) => `${severity}=${count}`)
    .join(" ");
}

/** The one-screen stop summary printed on WAKE-HUMAN, and reused for the console tail elsewhere. */
export function renderSummary(evaluation) {
  const lines = [];
  lines.push(`lap ${evaluation.lap}: ${evaluation.decision}`);
  lines.push("");

  const backingById = new Map((evaluation.backings ?? []).map((entry) => [entry.id, entry]));
  lines.push(`succeeded rows (${evaluation.succeeded.length}):`);
  if (evaluation.succeeded.length === 0) lines.push("  none");
  for (const row of sortFindingsBySeverity(evaluation.succeeded)) {
    const routed = effectiveSeverity(row);
    const stated = String(row.severity ?? "?");
    const relabelled = routed === stated ? "" : ` (stated ${stated})`;
    lines.push(`  [${routed}]${relabelled} ${row.id ?? "?"} ${row.part ?? ""}: ${row.mechanism ?? ""}`);
    lines.push(`      evidence: ${row.evidence ?? ""}`);
    lines.push(`      regression_test: ${row.regression_test ?? "null"}`);
    const backing = backingById.get(String(row.id ?? "?"));
    if (backing && !backing.verified) {
      lines.push(`      <- UNVERIFIED: ${backing.reasons.join("; ")}`);
    }
  }
  lines.push("");

  const branch = evaluation.attackerBranch;
  const checked = evaluation.artifactBacking?.checked;
  if (branch) {
    const present = (evaluation.artifactBacking?.presentPaths ?? []).length;
    const cited = new Set(
      (evaluation.backings ?? []).map((entry) => entry.regressionTest).filter((path) => path !== null),
    ).size;
    lines.push(
      checked
        ? `attacker branch: ${branch} (${present} of ${cited} cited artifact path(s) present)`
        : `attacker branch: ${branch} (artifacts not checked)`,
    );
  } else {
    lines.push("attacker branch: not recorded (artifacts not checked)");
  }
  lines.push("");

  const discrepancies = evaluation.severityDiscrepancies ?? [];
  if (discrepancies.length > 0) {
    lines.push("labeling discrepancies (routed on part, not on the stated field):");
    for (const entry of discrepancies) {
      lines.push(`  ${entry.id}: stated ${entry.stated}, routed ${entry.effective}, ${entry.reason}`);
    }
    lines.push("");
  }

  const diff = evaluation.residualDiff;
  if (diff.baseline) {
    lines.push(`residual set (baseline, no prior lap): ${evaluation.residualIds.join(", ") || "empty"}`);
  } else if (!diff.changed) {
    lines.push(`residual set unchanged: ${evaluation.residualIds.join(", ") || "empty"}`);
  } else {
    lines.push("residual set CHANGED:");
    lines.push(`  added:   ${diff.added.join(", ") || "none"}`);
    lines.push(`  removed: ${diff.removed.join(", ") || "none"}`);
    lines.push(`  now:     ${evaluation.residualIds.join(", ") || "empty"}`);
  }
  lines.push("");

  lines.push("fixer residual_delta:");
  if (evaluation.residualDeltas.length === 0) lines.push("  no fixer rows this lap");
  for (const entry of evaluation.residualDeltas) {
    const note = entry.kind === "unexplained" ? ` <- UNEXPLAINED: ${entry.reason}` : "";
    lines.push(`  item ${entry.item}: ${entry.raw ?? "(absent)"}${note}`);
  }
  lines.push("");

  lines.push("fixer reverts:");
  if (evaluation.reverts.length === 0) lines.push("  none");
  for (const entry of evaluation.reverts) {
    lines.push(`  item ${entry.item} reverts ${entry.commit}`);
  }
  lines.push("");

  const testCount = evaluation.gates.testsPassed ?? "unknown";
  const prior = evaluation.priorTestCount === null ? "n/a" : evaluation.priorTestCount;
  lines.push(
    `gates: ${evaluation.gates.passed ? "PASS" : "FAIL"} (tests passed ${testCount}, prior ${prior})`,
  );
  lines.push(`successes by severity: ${formatSeverityCounts(evaluation.successesBySeverity)}`);
  lines.push("");

  if (evaluation.wakeReasons.length > 0) {
    lines.push("wake reasons:");
    for (const reason of evaluation.wakeReasons) lines.push(`  - ${reason}`);
  } else if (evaluation.convergeBlockers.length > 0) {
    lines.push("converge blockers:");
    for (const reason of evaluation.convergeBlockers) lines.push(`  - ${reason}`);
  } else {
    lines.push("no wake reasons, no converge blockers");
  }
  return lines.join("\n");
}

/** One appended section of redteam/loop/state/summary.md. */
export function renderSummaryEntry(evaluation, { itemsFixed = [], timestamp = null } = {}) {
  const items =
    itemsFixed.length === 0 ? "none (no fix pass this lap)" : itemsFixed.map((item) => `item ${item}`).join(", ");
  const diff = evaluation.residualDiff;
  const residualLine = diff.baseline
    ? `baseline: ${evaluation.residualIds.join(", ") || "empty"}`
    : diff.changed
      ? `changed (added: ${diff.added.join(", ") || "none"}; removed: ${diff.removed.join(", ") || "none"})`
      : "unchanged";
  const backings = evaluation.backings ?? [];
  const citedPaths = new Set(
    backings.map((entry) => entry.regressionTest).filter((path) => path !== null),
  ).size;
  const presentPaths = (evaluation.artifactBacking?.presentPaths ?? []).length;
  const branchLine = evaluation.attackerBranch
    ? evaluation.artifactBacking?.checked
      ? `${evaluation.attackerBranch} (${presentPaths} of ${citedPaths} cited artifact path(s) present)`
      : `${evaluation.attackerBranch} (artifacts not checked)`
    : "not recorded (artifacts not checked)";

  const lines = [
    `## lap ${evaluation.lap}${timestamp ? ` (${timestamp})` : ""}`,
    "",
    `- items fixed: ${items}`,
    `- successes by severity: ${formatSeverityCounts(evaluation.successesBySeverity)}`,
    `- attacker branch: ${branchLine}`,
    `- residual set: ${residualLine}`,
    `- gates: ${evaluation.gates.passed ? "pass" : "fail"} (${evaluation.gates.testsPassed ?? "unknown"} tests passed)`,
    `- decision: ${evaluation.decision}`,
  ];
  const unbacked = evaluation.unbacked ?? [];
  if (unbacked.length > 0) {
    lines.push(
      `- unverified rows: ${unbacked.map((entry) => `${entry.id} (${entry.reasons.join("; ")})`).join("; ")}`,
    );
  }
  const discrepancies = evaluation.severityDiscrepancies ?? [];
  if (discrepancies.length > 0) {
    lines.push(
      `- labeling discrepancies: ${discrepancies
        .map((entry) => `${entry.id} stated ${entry.stated}, routed ${entry.effective} (${entry.reason})`)
        .join("; ")}`,
    );
  }
  const reasons = evaluation.wakeReasons.length > 0 ? evaluation.wakeReasons : evaluation.convergeBlockers;
  if (reasons.length > 0) {
    lines.push(`- because: ${reasons.join("; ")}`);
  }
  lines.push("", "");
  return lines.join("\n");
}
