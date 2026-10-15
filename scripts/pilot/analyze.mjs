/**
 * Read-only analysis of the pilot's launch records, by the pilot's own decision rules, from a
 * published evidence directory and nothing else: the manifest, the records, and the compressed
 * blobs the records cite, each verified against its digest. It needs no home directory, no
 * live session store, no model server and no repository access, and it refuses to derive a
 * table from evidence that is missing, corrupt, duplicated or short of the cells the manifest
 * froze: the result is then "incomplete" with every problem named, and the exit status is 1.
 *
 * It keeps four facts apart for every launch:
 *
 * - a record exists and is valid: the schema holds, the manifest matches, the budgets held and
 *   every cited blob is present with its digest;
 * - the patch is correct: the hidden oracle passed the final tree;
 * - the arm delivered: a correct patch, the visible checks resolved, the product finished
 *   normally within its budget and reported completion without contradiction (for Swarm its
 *   own acceptable verdict, evidence present and no oracle exposure; for OpenCode a final answer
 *   that reads as a completion claim under the keyword heuristic below, reported beside the text);
 * - the launch is eligible for a controlled comparison: the product's effective gate was the
 *   task's, the arm did not repair its environment inside the measured task, and its mutable
 *   state was not prepared by another launch. A detected mismatch or run-to-run contamination
 *   makes a launch ineligible whatever its outcome; the outcome itself still stands.
 *
 * Costs are over every launch, failed work included; a cost per delivery with zero deliveries is
 * undefined, never zero. Token totals are the arms' own accounts and are not comparable with
 * precision; both are shown and neither is adjusted.
 *
 *   node scripts/pilot/analyze.mjs --evidence <stage dir> [--evidence-b <stage dir>] [--out <json>] [--markdown <md>]
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { recordSchema } from "../comparison/schema.mjs";

export const analysisSchema = "swarm-real-task-pilot.analysis.v2";

/** The launcher's proved bound on confirming a kill after the deadline and grace (control.mjs). */
export const terminationBoundMs = 10_000;

/** The bytes of this analyzer, so a derived table names the rule it was derived by. */
export const analyzerDigest = `sha256:${createHash("sha256")
  .update(readFileSync(new URL(import.meta.url)))
  .digest("hex")}`;

const digestOf = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/**
 * A launch record's file name, as `scripts/comparison/analyze.mjs` defines it. Spelled here
 * rather than imported: that module runs its command-line block whenever the entry script is
 * named analyze.mjs, which this one is.
 */
export const isLaunchRecord = (name) =>
  /^[a-z][a-z0-9-]*\.(swarm|opencode)\.(json|(infrastructure|halted)-\d+\.json)$/.test(name);

/** Every digest a record cites, apart from the manifest's own. */
export function citedDigests(record) {
  const cited = JSON.stringify(record).match(/sha256:[0-9a-f]{64}/g) ?? [];
  return [...new Set(cited)].filter((digest) => digest !== record.manifestDigest);
}

/**
 * The evidence directory as a reader: every blob is read from `blobs/<hex>.gz`, decompressed
 * and checked against the digest it is filed under before a byte of it is used. A blob that is
 * absent or does not match reads as null, and is also reported by `validateStage`.
 */
export function evidenceReader(root) {
  const verified = new Map();
  return {
    root,
    blob(digest) {
      if (verified.has(digest)) return verified.get(digest);
      const path = join(root, "blobs", `${digest.slice(7)}.gz`);
      let text = null;
      if (existsSync(path)) {
        try {
          const bytes = gunzipSync(readFileSync(path));
          if (digestOf(bytes) === digest) text = bytes.toString("utf8");
        } catch {
          text = null;
        }
      }
      verified.set(digest, text);
      return text;
    },
    blobState(digest) {
      const path = join(root, "blobs", `${digest.slice(7)}.gz`);
      if (!existsSync(path)) return "missing";
      return this.blob(digest) === null ? "corrupt" : "verified";
    },
    /** An optional packaged file beside the records, parsed from its compressed JSON, or null. */
    json(relativePath) {
      const path = join(root, relativePath);
      if (!existsSync(path)) return null;
      try {
        return JSON.parse(
          path.endsWith(".gz")
            ? gunzipSync(readFileSync(path)).toString("utf8")
            : readFileSync(path, "utf8"),
        );
      } catch {
        return null;
      }
    },
  };
}

/** The JSON events of an arm's stdout, in order; lines that are not JSON are skipped. */
function events(stdout) {
  const out = [];
  for (const line of (stdout ?? "").split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}

/** Swarm's `swarm.result.v1` line, or null where the run wrote none. */
function swarmResult(stdout) {
  for (const line of (stdout ?? "").split("\n").reverse()) {
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.schema === "swarm.result.v1") return parsed;
    } catch {}
  }
  return null;
}

/**
 * OpenCode's own account of a run: its final text, its error events, how many turns it took.
 * The classification is a keyword heuristic over the final text: a phrase that reads as a
 * reported failure or an open problem makes the claim "uncertain", never a completion claim.
 * It is reported with the text so a reader can disagree with it.
 */
const doubtful =
  /\b(unable|could ?n[o']t|cannot|can't|not able|failed to|fails?|failing|still fail|did not|didn't|does ?n[o']t pass|not (?:yet )?(?:resolved|fixed|complete|working|passing|addressed)|unresolved|blocked|gave up|incomplete|partial(?:ly)?|remaining (?:issue|failure|problem)|however|unfortunately|out of (?:time|budget)|limit(?:ation)?s? of)\b/i;

function opencodeAccount(stdout) {
  const parsed = events(stdout);
  let finalText = null;
  let errors = 0;
  let turns = 0;
  let toolCalls = 0;
  const tokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  for (const event of parsed) {
    const part = event.part ?? event;
    const type = event.type ?? part?.type;
    if (type === "text" && typeof (part?.text ?? event.text) === "string")
      finalText = part?.text ?? event.text;
    else if (type === "error") errors += 1;
    else if (type === "step_finish" || type === "step-finish") {
      turns += 1;
      const t = part?.tokens ?? event.tokens;
      if (t) {
        tokens.input += t.input ?? 0;
        tokens.output += t.output ?? 0;
        tokens.reasoning += t.reasoning ?? 0;
        tokens.cacheRead += t.cache?.read ?? 0;
        tokens.cacheWrite += t.cache?.write ?? 0;
      }
    } else if (type === "tool_use" || type === "tool") toolCalls += 1;
  }
  return { finalText, errors, turns, toolCalls, tokens };
}

/** Swarm's own account: its result line, the stop reason, steps and tokens from its summary. */
function swarmAccount(stdout) {
  const result = swarmResult(stdout ?? "");
  const summary = /the run took (.+?), (\d+) steps?, ([\d,]+) tokens/.exec(stdout ?? "");
  const stops = events(stdout ?? "").filter(
    (event) => event.schema === "swarm.event.v1" && event.event?.type === "stopped",
  );
  return {
    acceptable: result?.verdict?.acceptable ?? null,
    exitCodeReported: result?.exitCode ?? null,
    assessment: result?.verdict?.reasons?.assessment ?? null,
    taskReason: result?.verdict?.reasons?.task ?? null,
    stopped:
      result?.outcome?.stopped ?? stops.map((one) => one.event.reason ?? "").join("; ") ?? null,
    loops: stops.length,
    steps: summary ? Number(summary[2]) : null,
    tokensReported: summary ? Number(summary[3].replace(/,/g, "")) : null,
    bundleDirectory: result?.bundleDirectory ?? null,
    runId: result?.runId ?? null,
  };
}

function classifyClaim(record, lastStdout) {
  const last = record.invocations.at(-1);
  if (!last) return { claim: "no-invocation", basis: "nothing ran" };
  if (lastStdout === null)
    return {
      claim: "unreadable",
      basis: "the invocation's stdout blob is not in the evidence, so its account cannot be read",
    };
  if (record.arm === "swarm") {
    const account = swarmAccount(lastStdout);
    if (last.signal !== null) return { claim: "killed", basis: `ended on ${last.signal}`, account };
    if (last.exitCode === 0 && account.acceptable === true)
      return { claim: "claims-completion", basis: "exit 0 with an acceptable verdict", account };
    if (last.exitCode === 0)
      return {
        claim: "uncertain",
        basis: "exit 0 but no acceptable verdict line was read",
        account,
      };
    return {
      claim: "reports-not-acceptable",
      basis: `exit ${last.exitCode}: ${account.assessment ?? "no verdict line"}`,
      account,
    };
  }
  const account = opencodeAccount(lastStdout);
  if (last.signal !== null) return { claim: "killed", basis: `ended on ${last.signal}`, account };
  if (last.exitCode !== 0 || account.errors > 0)
    return {
      claim: "reports-error",
      basis: `exit ${last.exitCode}, ${account.errors} error event(s)`,
      account,
    };
  if (account.finalText === null || account.finalText.trim() === "")
    return { claim: "no-answer", basis: "the last turn carried no text", account };
  if (doubtful.test(account.finalText))
    return {
      claim: "uncertain",
      basis: `the final text matches ${doubtful.exec(account.finalText)?.[0] ?? "a doubtful phrase"}; read it`,
      account,
    };
  return { claim: "claims-completion", basis: "final text with no reported failure", account };
}

/**
 * Two spellings of one npm script invocation read as the same command: `npm test`,
 * `npm run test` and `npm run --loglevel=error test` all run the manifest's `test` script.
 * Nothing else is folded; `npx tap` and `npm test` stay different even where the script body
 * is `tap`, and the eligibility says so with the body beside it where the evidence carries it.
 */
export function normalizeCommand(command) {
  if (command === null || command === undefined) return null;
  const trimmed = command.trim().replace(/\s+/g, " ");
  const run = /^npm run(?:-script)? (?:--silent |-s |--loglevel=error )?([A-Za-z0-9:._-]+)$/.exec(
    trimmed,
  );
  if (run) return `npm run ${run[1]}`;
  if (/^npm (?:test|t)$/.test(trimmed)) return "npm run test";
  return trimmed;
}

/** The gate the product planned as its blocking tests gate, from the stdout it printed. */
function plannedTestsGate(stdout) {
  const match = /^plan: tests \(blocking\): (.+)$/m.exec(stdout ?? "");
  return match ? match[1].trim() : null;
}

const installedBrowsers = (stdout) =>
  /playwright install|downloaded to \S*ms-playwright/i.test(stdout ?? "");

/**
 * What the launch's eligibility for a controlled comparison rests on, from the record and the
 * blobs. `context.task` is the frozen task; `context.earlierSwarmInstalls` says whether an
 * earlier Swarm launch of the same stage installed a prerequisite into a home this launch could
 * have shared; `context.testsGateRan` is the tests gate's own output where the evidence packages
 * the session's gate runs, used to tell whether that gate depended on the shared prerequisite.
 */
export function eligibility(record, stdouts, context) {
  const reasons = [];
  const facts = {
    effectiveTestsGate: null,
    expectedTestsGate: context.task ? context.task.projectTest.join(" ") : null,
    gateMismatch: null,
    scriptBody: null,
    sharedHome: record.preparedState === undefined,
    installedPrerequisite: false,
    dependedOnSharedPrerequisite: null,
  };
  if (record.arm === "swarm") {
    const first = stdouts[0] ?? null;
    facts.effectiveTestsGate =
      record.gatePlan?.effective ?? (first === null ? null : plannedTestsGate(first));
    if (facts.expectedTestsGate !== null && facts.effectiveTestsGate !== null) {
      facts.gateMismatch =
        normalizeCommand(facts.effectiveTestsGate) !== normalizeCommand(facts.expectedTestsGate);
      const script = /^npm run ([A-Za-z0-9:._-]+)$/.exec(
        normalizeCommand(facts.effectiveTestsGate) ?? "",
      )?.[1];
      facts.scriptBody = script ? (context.scripts?.[script] ?? null) : null;
      if (facts.gateMismatch)
        reasons.push(
          `the product's blocking tests gate was ${JSON.stringify(facts.effectiveTestsGate)}${facts.scriptBody ? ` (script body ${JSON.stringify(facts.scriptBody)})` : ""}, not the task's ${JSON.stringify(facts.expectedTestsGate)}`,
        );
    } else if (facts.effectiveTestsGate === null) {
      facts.gateMismatch = null;
      reasons.push("the product's effective tests gate could not be read from the evidence");
    }
    facts.installedPrerequisite = stdouts.some(installedBrowsers);
    if (facts.installedPrerequisite)
      reasons.push(
        "the arm installed a prerequisite (browsers) into its environment inside the measured task",
      );
    if (facts.sharedHome) {
      if (context.earlierSwarmInstalls) {
        const output = context.testsGateRan;
        facts.dependedOnSharedPrerequisite =
          output === null ? null : /test-chrome|playwright|chromium/i.test(output);
        if (facts.dependedOnSharedPrerequisite === true)
          reasons.push(
            "its tests gate ran a browser suite against browsers an earlier launch had installed into the one shared child HOME",
          );
        else if (facts.dependedOnSharedPrerequisite === null)
          reasons.push(
            "it ran in a child HOME an earlier launch had changed, and whether its gate depended on that change cannot be read from the evidence",
          );
      }
    }
  } else if (facts.sharedHome) {
    // OpenCode's processes inherited the operator's own HOME; nothing in the evidence says
    // another launch prepared it, and nothing says it did not.
    facts.dependedOnSharedPrerequisite = null;
  }
  return { eligible: reasons.length === 0, reasons, facts };
}

export function analyzeRecord(record, context = {}) {
  const read = context.blob ?? (() => null);
  const last = record.invocations.at(-1) ?? null;
  const stdouts = record.invocations.map((one) => read(one.stdoutDigest));
  const lastStdout = last ? (stdouts.at(-1) ?? null) : null;
  const claim = classifyClaim(record, lastStdout);
  const correctPatch = record.hidden.verdict === "pass";
  const finishedNormally = last !== null && last.signal === null && last.exitCode === 0;
  const exposure = record.oracleExposure.startsWith("EXPOSURE");
  const reasons = [];
  if (!correctPatch) reasons.push(`hidden ${record.hidden.verdict}: ${record.hidden.basis}`);
  if (!record.resolvedVisible) reasons.push("visible checks never resolved");
  if (!finishedNormally)
    reasons.push(
      last === null
        ? "no invocation"
        : last.signal !== null
          ? `killed at the wall (${last.signal})`
          : `exit ${last.exitCode}`,
    );
  if (claim.claim !== "claims-completion") reasons.push(`claim: ${claim.claim} (${claim.basis})`);
  if (record.arm === "swarm" && claim.account?.acceptable !== true)
    reasons.push("swarm's own verdict is not acceptable");
  if (exposure) reasons.push("oracle exposure");
  if (record.infrastructureFailure !== null || record.halt)
    reasons.push(`not a valid launch: ${record.infrastructureFailure ?? "halted"}`);
  const delivered = reasons.length === 0;
  const elapsedMs = Date.parse(record.endedAt) - Date.parse(record.startedAt);
  const eligible = eligibility(record, stdouts, context);
  return {
    task: record.task,
    arm: record.arm,
    order: record.order,
    valid: record.infrastructureFailure === null && !record.halt && !exposure,
    eligible: eligible.eligible,
    ineligibleBecause: eligible.reasons,
    setup: eligible.facts,
    correctPatch,
    delivered,
    deliveredWithoutCorrection: delivered && record.corrections === 0,
    falseClaim: claim.claim === "claims-completion" && !correctPatch,
    claim: claim.claim,
    claimBasis: claim.basis,
    account: claim.account ?? null,
    finalText:
      record.arm === "opencode"
        ? ((claim.account?.finalText ?? null)?.slice(0, 1200) ?? null)
        : null,
    notDeliveredBecause: reasons,
    corrections: record.corrections,
    invocations: record.invocations.map((one) => ({
      kind: one.kind,
      exitCode: one.exitCode,
      signal: one.signal,
      wallMs: one.wallMs,
      tokens: one.tokens,
      visible: one.visible.passed,
      claimedSuccess: one.claimedSuccess,
    })),
    resolvedVisible: record.resolvedVisible,
    hidden: record.hidden.verdict,
    hiddenBasis: record.hidden.basis,
    oracleExposure: record.oracleExposure,
    time: {
      agentMs: record.totals.agentWallMs,
      preparationMs: record.preparation.wallMs,
      // What the launch spent outside the arm and its install: patch extraction, the visible
      // verdicts and the hidden scoring, each in a fresh checkout.
      scoringAndHarnessMs: Math.max(
        0,
        elapsedMs - record.totals.agentWallMs - record.preparation.wallMs,
      ),
      elapsedMs,
    },
    tokens: {
      total: record.totals.tokens,
      unknownInvocations: record.totals.tokensUnknownInvocations,
      perInvocationCap: record.arm === "swarm" ? 600_000 : null,
      capBound:
        record.arm === "swarm"
          ? record.invocations.some((one) => (one.tokens ?? 0) >= (one.tokenAllowance ?? 600_000))
          : null,
      // The spend by kind as the arm reported it, summed over the invocations; a kind no
      // invocation reported stays null, and a launch whose record predates the breakdown reads
      // as null whole.
      usage: usageOf(record.invocations),
    },
    preparedState: record.preparedState ?? null,
    gatePlan: record.gatePlan ?? null,
    notes: record.notes,
    finalPatchDigest: record.finalPatchDigest,
    finalPatchBytes: record.finalPatchBytes,
  };
}

const sum = (rows, pick) => rows.reduce((total, row) => total + (pick(row) ?? 0), 0);

/** Usage by kind added up over invocations or launches; null where none carries it. */
export function usageOf(parts) {
  let total = null;
  for (const part of parts) {
    const usage = part.usage ?? null;
    if (usage === null) continue;
    const add = (a, b) => (b === null || b === undefined ? a : (a ?? 0) + b);
    const base = total ?? {
      input: 0,
      output: 0,
      reasoning: null,
      cacheRead: null,
      cacheWrite: null,
    };
    total = {
      input: base.input + usage.input,
      output: base.output + usage.output,
      reasoning: add(base.reasoning, usage.reasoning),
      cacheRead: add(base.cacheRead, usage.cacheRead),
      cacheWrite: add(base.cacheWrite, usage.cacheWrite),
    };
  }
  return total;
}

export function armSummary(rows) {
  const delivered = rows.filter((row) => row.delivered);
  const allTokensKnown = rows.every(
    (row) => row.tokens.total !== null && row.tokens.unknownInvocations === 0,
  );
  const perDelivery = (total) =>
    delivered.length === 0 ? "undefined (zero deliveries)" : total / delivered.length;
  return {
    launches: rows.length,
    valid: rows.filter((row) => row.valid).length,
    eligible: rows.filter((row) => row.eligible).length,
    correctPatches: rows.filter((row) => row.correctPatch).length,
    deliveries: delivered.length,
    deliveriesEligible: delivered.filter((row) => row.eligible).length,
    deliveriesWithoutCorrection: rows.filter((row) => row.deliveredWithoutCorrection).length,
    falseClaims: rows.filter((row) => row.falseClaim).length,
    uncertainClaims: rows.filter((row) => row.claim === "uncertain").length,
    correctionsTotal: sum(rows, (row) => row.corrections),
    killedAtWall: rows.filter((row) => row.invocations.some((one) => one.signal !== null)).length,
    agentMs: sum(rows, (row) => row.time.agentMs),
    preparationMs: sum(rows, (row) => row.time.preparationMs),
    scoringAndHarnessMs: sum(rows, (row) => row.time.scoringAndHarnessMs),
    elapsedMs: sum(rows, (row) => row.time.elapsedMs),
    tokensKnown: allTokensKnown ? sum(rows, (row) => row.tokens.total) : null,
    tokensUnknownLaunches: rows.filter(
      (row) => row.tokens.total === null || row.tokens.unknownInvocations > 0,
    ).length,
    usage: usageOf(rows.map((row) => ({ usage: row.tokens.usage ?? null }))),
    usageLaunchesWithout: rows.filter((row) => (row.tokens.usage ?? null) === null).length,
    costPerDelivery: {
      agentMinutes: perDelivery(sum(rows, (row) => row.time.agentMs) / 60_000),
      endToEndMinutes: perDelivery(sum(rows, (row) => row.time.elapsedMs) / 60_000),
      tokens: allTokensKnown
        ? perDelivery(sum(rows, (row) => row.tokens.total))
        : "not precise: usage unknown for some launch",
    },
  };
}

/** The comparative-benefit rule the protocol states, applied to one set of rows. */
function benefit(rows) {
  const swarm = rows.filter((row) => row.arm === "swarm");
  const opencode = rows.filter((row) => row.arm === "opencode");
  const s = armSummary(swarm);
  const o = armSummary(opencode);
  const both = swarm
    .filter((row) => row.delivered)
    .map((row) => row.task)
    .filter((task) => opencode.some((row) => row.task === task && row.delivered));
  const correctionsNoWorse = both.every(
    (task) =>
      swarm.find((row) => row.task === task).corrections <=
      opencode.find((row) => row.task === task).corrections,
  );
  const timeRoute =
    s.deliveries === o.deliveries &&
    s.deliveries > 0 &&
    s.elapsedMs <= 0.8 * o.elapsedMs &&
    correctionsNoWorse;
  return {
    holds: s.deliveries > o.deliveries || timeRoute,
    value: `deliveries swarm ${s.deliveries} vs opencode ${o.deliveries}; end-to-end ${(s.elapsedMs / 60_000).toFixed(1)} vs ${(o.elapsedMs / 60_000).toFixed(1)} min; corrections no worse on the ${both.length} task(s) both deliver: ${correctionsNoWorse}`,
  };
}

/** The frozen Stage A gate, item by item, each with the value it was decided on. */
export function stageAGate(rows, tasks, validity = { complete: true, problems: [] }) {
  const swarm = rows.filter((row) => row.arm === "swarm");
  const byType = (type) => tasks.find((task) => task.workType === type)?.id;
  const deliveredIds = new Set(swarm.filter((row) => row.delivered).map((row) => row.task));
  const items = [];
  const ineligible = rows.filter((row) => !row.eligible);
  items.push({
    item: "eight valid, inspectable launches; no unresolved setup/scoring problem; no exposure",
    holds: validity.complete && rows.length === 8 && rows.every((row) => row.valid && row.eligible),
    value: `${rows.filter((row) => row.valid).length} valid of ${rows.length} recorded; ${validity.complete ? "evidence complete" : `evidence incomplete (${validity.problems.length} problem(s))`}; ${ineligible.length === 0 ? "no setup problem" : `setup problems on ${ineligible.map((row) => `${row.task} ${row.arm}`).join(", ")}`}`,
  });
  items.push({
    item: "Swarm correctly delivers at least three of four, including the bug fix and the feature",
    holds:
      deliveredIds.size >= 3 &&
      deliveredIds.has(byType("bugfix")) &&
      deliveredIds.has(byType("feature")),
    value: `${deliveredIds.size} delivered: ${[...deliveredIds].join(", ") || "none"}`,
  });
  items.push({
    item: "Swarm makes zero false completion claims, needs no manual repair or hints, respects controls and budgets",
    holds:
      swarm.every((row) => !row.falseClaim) &&
      swarm.every((row) => row.time.agentMs <= 20 * 60_000) &&
      rows.every((row) => row.valid),
    value: `${swarm.filter((row) => row.falseClaim).length} false claim(s); max agent time ${(Math.max(0, ...swarm.map((row) => row.time.agentMs)) / 60_000).toFixed(1)} min; manual involvement: none recorded by the launcher; exposure status: as scanned by the launcher, unknown beyond that scan`,
  });
  const comparative = benefit(rows);
  items.push({
    item: "comparative benefit: Swarm delivers more; or the same number with at least 20% less end-to-end time over the four tasks and no more corrections on tasks both deliver",
    ...comparative,
  });
  return { items, qualifies: items.every((one) => one.holds) };
}

/** Which protocol's rule a stage is decided by: the manifest says which comparison froze it. */
export function ruleFor(manifest) {
  return typeof manifest?.purpose === "string" &&
    manifest.purpose.startsWith("comparison 2026-10-15")
    ? "2026-10-15"
    : "pilot-2026-10-14";
}

/**
 * The primary measures the 2026-10-15 protocol declared, compared arm against arm: quality and
 * supervision (deliveries, deliveries without correction, false claims, corrections, launches
 * killed at the wall, unresolved launches) and the two cost measures (end-to-end minutes and
 * tokens per correct delivery). Each is a win, tie, loss or unknown for Swarm; a quality
 * advantage needs a win on deliveries without correction, or fewer corrections at equal
 * deliveries. The third route the protocol allows, a predeclared independently checked quality
 * improvement, is not derivable here and is reported as unjudged by the analyzer.
 */
export function primaryMeasures(rows) {
  const s = armSummary(rows.filter((row) => row.arm === "swarm"));
  const o = armSummary(rows.filter((row) => row.arm === "opencode"));
  const compare = (a, b, higherIsBetter) =>
    typeof a !== "number" || typeof b !== "number"
      ? "unknown"
      : a === b
        ? "tie"
        : (higherIsBetter ? a > b : a < b)
          ? "win"
          : "loss";
  const unresolved = (a) => a.launches - a.deliveries;
  const measures = [
    {
      measure: "correct deliveries",
      swarm: s.deliveries,
      opencode: o.deliveries,
      verdict: compare(s.deliveries, o.deliveries, true),
    },
    {
      measure: "deliveries without correction",
      swarm: s.deliveriesWithoutCorrection,
      opencode: o.deliveriesWithoutCorrection,
      verdict: compare(s.deliveriesWithoutCorrection, o.deliveriesWithoutCorrection, true),
    },
    {
      measure: "false completion claims",
      swarm: s.falseClaims,
      opencode: o.falseClaims,
      verdict: compare(s.falseClaims, o.falseClaims, false),
    },
    {
      measure: "scripted corrections",
      swarm: s.correctionsTotal,
      opencode: o.correctionsTotal,
      verdict: compare(s.correctionsTotal, o.correctionsTotal, false),
    },
    {
      measure: "launches killed at the wall",
      swarm: s.killedAtWall,
      opencode: o.killedAtWall,
      verdict: compare(s.killedAtWall, o.killedAtWall, false),
    },
    {
      measure: "unresolved launches (no correct delivery)",
      swarm: unresolved(s),
      opencode: unresolved(o),
      verdict: compare(unresolved(s), unresolved(o), false),
    },
    {
      measure: "end-to-end minutes per correct delivery (cost)",
      swarm: s.costPerDelivery.endToEndMinutes,
      opencode: o.costPerDelivery.endToEndMinutes,
      verdict: compare(s.costPerDelivery.endToEndMinutes, o.costPerDelivery.endToEndMinutes, false),
    },
    {
      measure: "tokens per correct delivery, as each arm reports them (cost)",
      swarm: s.costPerDelivery.tokens,
      opencode: o.costPerDelivery.tokens,
      verdict: compare(s.costPerDelivery.tokens, o.costPerDelivery.tokens, false),
    },
  ];
  const quality = measures.slice(0, 6);
  const cost = measures.slice(6);
  const advantage =
    measures[1].verdict === "win" ||
    (measures[0].verdict === "tie" && s.deliveries > 0 && measures[3].verdict === "win");
  return {
    measures,
    advantage,
    advantageBasis: advantage
      ? measures[1].verdict === "win"
        ? "more correct deliveries without correction"
        : "fewer corrections at equal delivery performance"
      : "neither more deliveries without correction nor fewer corrections at equal deliveries; a predeclared quality improvement is not derivable by the analyzer and stays unjudged",
    noWorse: quality.every((one) => one.verdict !== "loss"),
    costRegression: cost.some((one) => one.verdict === "loss"),
    costUnresolved: cost.some((one) => one.verdict === "unknown"),
  };
}

/** The 2026-10-15 protocol's stage A spending rule, item by item. */
export function stageAGate2026_10_15(rows, tasks, validity = { complete: true, problems: [] }) {
  const swarm = rows.filter((row) => row.arm === "swarm");
  const byType = (type) => tasks.find((task) => task.workType === type)?.id;
  const deliveredIds = new Set(swarm.filter((row) => row.delivered).map((row) => row.task));
  const ineligible = rows.filter((row) => !row.eligible);
  const primary = primaryMeasures(rows);
  const items = [
    {
      item: "all eight stage A records valid and inspectable; no unresolved setup, scoring or exposure problem",
      holds:
        validity.complete && rows.length === 8 && rows.every((row) => row.valid && row.eligible),
      value: `${rows.filter((row) => row.valid).length} valid of ${rows.length} recorded; ${validity.complete ? "evidence complete" : `evidence incomplete (${validity.problems.length} problem(s))`}; ${ineligible.length === 0 ? "no setup problem" : `setup problems on ${ineligible.map((row) => `${row.task} ${row.arm}`).join(", ")}`}`,
    },
    {
      item: "Swarm correctly delivers at least three of four, including the bug fix and the feature, with no manual help and no false completion claim (every delivery met the hidden oracle, which holds the task's mandatory requirements)",
      holds:
        deliveredIds.size >= 3 &&
        deliveredIds.has(byType("bugfix")) &&
        deliveredIds.has(byType("feature")) &&
        swarm.every((row) => !row.falseClaim),
      value: `${deliveredIds.size} delivered: ${[...deliveredIds].join(", ") || "none"}; ${swarm.filter((row) => row.falseClaim).length} false claim(s); manual involvement: none recorded by the launcher`,
    },
    {
      item: "a concrete quality or supervision advantage: more correct deliveries without correction, or fewer corrections at equal delivery performance (the predeclared-quality route is judged outside the analyzer)",
      holds: primary.advantage,
      value: primary.advantageBasis,
    },
    {
      item: "Swarm no worse on the other primary quality, supervision and reliability measures; primary cost measures shown, a regression or an unresolved one named",
      holds: primary.noWorse,
      value: `${primary.measures.map((one) => `${one.measure}: ${one.verdict} (${number(one.swarm)} vs ${number(one.opencode)})`).join("; ")}; cost regression: ${primary.costRegression ? "yes" : "no"}; cost unresolved: ${primary.costUnresolved ? "yes" : "no"}`,
    },
  ];
  return { items, qualifies: items.every((one) => one.holds), primary };
}

/** The 2026-10-15 protocol's stage B rule: both repetitions delivered, the advantage still supported combined. */
export function stageBGate2026_10_15(rowsB, rowsAll, validity = { complete: true, problems: [] }) {
  const swarmB = rowsB.filter((row) => row.arm === "swarm");
  const opencodeB = rowsB.filter((row) => row.arm === "opencode");
  const primary = primaryMeasures(rowsAll);
  const items = [
    {
      item: "both repeated tasks recorded under both arms, evidence complete",
      holds:
        validity.complete &&
        rowsB.length === 4 &&
        swarmB.length === 2 &&
        opencodeB.length === 2 &&
        rowsB.every((row) => row.valid && row.eligible),
      value: `${rowsB.length} record(s): swarm ${swarmB.length}, opencode ${opencodeB.length}; ${validity.complete ? "evidence complete" : "evidence incomplete"}`,
    },
    {
      item: "both repeated tasks correctly delivered by Swarm",
      holds: swarmB.length === 2 && swarmB.every((row) => row.delivered),
      value:
        swarmB
          .map((row) => `${row.task}: ${row.delivered ? "delivered" : "not delivered"}`)
          .join("; ") || "not run",
    },
    {
      item: "zero false claims or control failures throughout",
      holds: rowsAll.every((row) => row.valid && !(row.arm === "swarm" && row.falseClaim)),
      value: `${rowsAll.filter((row) => row.arm === "swarm" && row.falseClaim).length} false claim(s), ${rowsAll.filter((row) => !row.valid).length} invalid launch(es)`,
    },
    {
      item: "the advantage still supported in the combined descriptive results, Swarm no worse on the other primary measures",
      holds: primary.advantage && primary.noWorse,
      value: `${primary.advantageBasis}; no worse: ${primary.noWorse}; cost regression: ${primary.costRegression ? "yes" : "no"}`,
    },
  ];
  return { items, proceeds: items.every((one) => one.holds), primary };
}

/**
 * The stage B gate needs the records the protocol froze: both repeated tasks under both arms,
 * four records, before any of its items can hold. A missing arm cannot manufacture a benefit:
 * with no OpenCode records, "more deliveries" would hold against zero, and it does not.
 */
export function stageBGate(rowsB, rowsAll, validity = { complete: true, problems: [] }) {
  const swarmB = rowsB.filter((row) => row.arm === "swarm");
  const opencodeB = rowsB.filter((row) => row.arm === "opencode");
  const items = [];
  items.push({
    item: "both repeated tasks recorded under both arms, evidence complete",
    holds:
      validity.complete &&
      rowsB.length === 4 &&
      swarmB.length === 2 &&
      opencodeB.length === 2 &&
      rowsB.every((row) => row.valid && row.eligible),
    value: `${rowsB.length} record(s): swarm ${swarmB.length}, opencode ${opencodeB.length}; ${validity.complete ? "evidence complete" : "evidence incomplete"}`,
  });
  items.push({
    item: "both repeated tasks correctly delivered by Swarm",
    holds: swarmB.length === 2 && swarmB.every((row) => row.delivered),
    value:
      swarmB
        .map((row) => `${row.task}: ${row.delivered ? "delivered" : "not delivered"}`)
        .join("; ") || "not run",
  });
  items.push({
    item: "zero false claims or control failures throughout",
    holds: rowsAll.every((row) => row.valid && !(row.arm === "swarm" && row.falseClaim)),
    value: `${rowsAll.filter((row) => row.arm === "swarm" && row.falseClaim).length} false claim(s), ${rowsAll.filter((row) => !row.valid).length} invalid launch(es)`,
  });
  items.push({
    item: "the same comparative-benefit rule on the combined results, corrections included",
    ...benefit(rowsAll),
  });
  return { items, proceeds: items.every((one) => one.holds) };
}

/**
 * Whether the published evidence is what the manifest froze: every launch record validates and
 * names this manifest; every frozen cell has exactly one record and no cell has two; the budgets
 * held; every cited blob is present and matches its digest. Each problem is one sentence.
 */
export function validateStage(evidence, manifest, manifestDigest, records) {
  const problems = [];
  const launchRecords = records.filter((one) =>
    /^[a-z][a-z0-9-]*\.(swarm|opencode)\.json$/.test(one.name),
  );
  const cells = new Map();
  for (const entry of launchRecords) {
    const { commands: _commands, name, ...stored } = entry;
    const parsed = recordSchema.safeParse(stored);
    if (!parsed.success) {
      problems.push(
        `${name} does not validate: ${parsed.error.message.split("\n")[0].slice(0, 160)}`,
      );
      continue;
    }
    const record = parsed.data;
    if (record.manifestDigest !== manifestDigest)
      problems.push(`${name} names manifest ${record.manifestDigest}, not ${manifestDigest}`);
    const key = `${record.task}\u0000${record.arm}`;
    if (cells.has(key)) problems.push(`${name} duplicates the cell ${record.task} ${record.arm}`);
    cells.set(key, record);
    if (
      !manifest.launches.some((launch) => launch.task === record.task && launch.arm === record.arm)
    )
      problems.push(`${name} is a cell the manifest did not freeze`);
    const wall = manifest.budgets.wallMsPerInvocation;
    // An invocation may run to the deadline plus the grace; the kill the launcher sends then
    // is confirmed within its termination bound (10 s, the proved control), so a few
    // milliseconds past the grace is the kill landing, not an overrun.
    const grace = manifest.budgets.wallGraceMs ?? 60_000;
    const bound = wall + grace + terminationBoundMs;
    for (const [index, invocation] of record.invocations.entries())
      if (invocation.wallMs > bound)
        problems.push(
          `${name} invocation ${index} ran ${invocation.wallMs} ms, over the ${wall} ms deadline plus ${grace} ms grace and the ${terminationBoundMs} ms termination bound`,
        );
    if (record.totals.agentWallMs > bound)
      problems.push(
        `${name} agent time ${record.totals.agentWallMs} ms exceeds the launch deadline plus grace and the termination bound`,
      );
    for (const digest of citedDigests(entry)) {
      const state = evidence.blobState(digest);
      if (state !== "verified")
        problems.push(`${name} cites ${digest}, which is ${state} in the evidence`);
    }
  }
  for (const launch of manifest.launches)
    if (!cells.has(`${launch.task}\u0000${launch.arm}`))
      problems.push(`the frozen cell ${launch.task} ${launch.arm} has no record`);
  return { complete: problems.length === 0, problems, cells: cells.size };
}

/** One stage read whole from its evidence directory: manifest, records, validity and rows. */
export function readStage(root) {
  const evidence = evidenceReader(root);
  const manifestPath = join(root, "manifest.json");
  if (!existsSync(manifestPath))
    return {
      root,
      manifest: null,
      digest: null,
      records: [],
      halts: [],
      recoveries: [],
      rows: [],
      validity: { complete: false, problems: [`${manifestPath} is missing`], cells: 0 },
    };
  const bytes = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(bytes);
  const digest = digestOf(bytes);
  const recordsDir = join(root, "records");
  const names = existsSync(recordsDir) ? readdirSync(recordsDir).sort() : [];
  const records = names
    .filter(isLaunchRecord)
    .map((name) => ({ name, ...JSON.parse(readFileSync(join(recordsDir, name), "utf8")) }));
  const halts = names.filter((name) => /^halt-\d+\.json$/.test(name));
  const recoveries = names.filter((name) => /^recovery-\d+\.json$/.test(name));
  const validity = validateStage(evidence, manifest, digest, records);
  const scripts = evidence.json("project-scripts.json") ?? {};
  const swarmInstalls = records
    .filter((record) => record.arm === "swarm")
    .map((record) => ({
      startedAt: Date.parse(record.startedAt),
      installed: record.invocations.some((one) =>
        installedBrowsers(evidence.blob(one.stdoutDigest)),
      ),
    }));
  const rows = records.map((record) => {
    const earlierSwarmInstalls = swarmInstalls.some(
      (one) => one.installed && one.startedAt < Date.parse(record.startedAt),
    );
    const runId =
      record.arm === "swarm"
        ? (swarmResult(evidence.blob(record.invocations[0]?.stdoutDigest ?? "") ?? "")?.runId ??
          null)
        : null;
    const gateRuns =
      runId === null ? null : evidence.json(join("sessions", runId, "gate-runs.json.gz"));
    const testsRun = gateRuns?.find((run) => run.gateId === "tests" && run.attempt === 0) ?? null;
    return analyzeRecord(record, {
      blob: (cited) => evidence.blob(cited),
      task: manifest.tasks.find((task) => task.id === record.task) ?? null,
      scripts: scripts[record.task] ?? null,
      earlierSwarmInstalls,
      testsGateRan:
        testsRun === null
          ? null
          : `${testsRun.command ?? ""}\n${testsRun.stdout ?? ""}\n${testsRun.stderr ?? ""}`,
    });
  });
  return { root, manifest, digest, records, halts, recoveries, rows, validity };
}

const minutes = (ms) => `${(ms / 60_000).toFixed(1)} min`;
const number = (value) =>
  typeof value === "number"
    ? value.toLocaleString("en-US", { maximumFractionDigits: 1 })
    : String(value);

export function renderMarkdown(stageA, stageB, labels = {}) {
  const labelA = labels.a ?? "Stage A: four fresh tasks, one launch per arm";
  const shortA = labels.shortA ?? "Stage A";
  const lines = [];
  const validityLines = (stage, label) => {
    lines.push(`### ${label}: evidence ${stage.validity.complete ? "complete" : "INCOMPLETE"}`, "");
    if (stage.validity.complete)
      lines.push(
        `Manifest \`${stage.digest}\`; ${stage.validity.cells} of ${stage.manifest.launches.length} frozen cells recorded once each; every cited blob present and verified; halts ${stage.halts.length}, recoveries ${stage.recoveries.length}.`,
        "",
      );
    else {
      lines.push("The tables below are not derived; the problems are:", "");
      for (const problem of stage.validity.problems) lines.push(`- ${problem}`);
      lines.push("");
    }
  };
  const pairedTable = (rows, title) => {
    lines.push(
      `### ${title}`,
      "",
      "| task | arm | record valid | eligible for comparison | correct patch | delivered | corrections | claim | agent | end-to-end | tokens | why not delivered | why not eligible |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const row of [...rows].sort((a, b) => a.order - b.order))
      lines.push(
        `| ${row.task} | ${row.arm} | ${row.valid ? "yes" : "no"} | ${row.eligible ? "yes" : "no"} | ${row.correctPatch ? "yes" : "no"} | ${row.delivered ? "yes" : "no"} | ${row.corrections} | ${row.claim} | ${minutes(row.time.agentMs)} | ${minutes(row.time.elapsedMs)} | ${row.tokens.total === null ? "unknown" : row.tokens.total.toLocaleString("en-US")}${row.tokens.unknownInvocations ? ` (+${row.tokens.unknownInvocations} unknown)` : ""} | ${row.notDeliveredBecause.join("; ") || ""} | ${row.ineligibleBecause.join("; ") || ""} |`,
      );
    lines.push("");
  };
  const armTable = (rows, title) => {
    const s = armSummary(rows.filter((row) => row.arm === "swarm"));
    const o = armSummary(rows.filter((row) => row.arm === "opencode"));
    lines.push(`### ${title}`, "", "| measure | swarm | opencode |", "| --- | --- | --- |");
    const row = (label, pick) => lines.push(`| ${label} | ${pick(s)} | ${pick(o)} |`);
    row("launches recorded (valid, eligible)", (a) => `${a.launches} (${a.valid}, ${a.eligible})`);
    row("correct patches", (a) => `${a.correctPatches}`);
    row(
      "correctly delivered (of which eligible)",
      (a) => `${a.deliveries} (${a.deliveriesEligible})`,
    );
    row("delivered without scripted correction", (a) => `${a.deliveriesWithoutCorrection}`);
    row("claimed completion the oracle rejects", (a) => `${a.falseClaims}`);
    row("uncertain claims", (a) => `${a.uncertainClaims}`);
    row("scripted corrections, total", (a) => `${a.correctionsTotal}`);
    row("launches killed at the wall", (a) => `${a.killedAtWall}`);
    row("agent time, all launches", (a) => minutes(a.agentMs));
    row("preparation (install), all launches", (a) => minutes(a.preparationMs));
    row("scoring and harness, all launches", (a) => minutes(a.scoringAndHarnessMs));
    row("end-to-end, all launches", (a) => minutes(a.elapsedMs));
    row("tokens, all launches", (a) =>
      a.tokensKnown === null
        ? `not fully known (${a.tokensUnknownLaunches} launch(es) with unknown usage)`
        : a.tokensKnown.toLocaleString("en-US"),
    );
    const kind = (label, pick) =>
      row(`${label}, as each arm reports it`, (a) =>
        a.usage === null
          ? "not reported"
          : `${pick(a.usage) === null ? "not reported" : pick(a.usage).toLocaleString("en-US")}${a.usageLaunchesWithout > 0 ? ` (${a.usageLaunchesWithout} launch(es) without a breakdown)` : ""}`,
      );
    kind("input tokens", (u) => u.input);
    kind("output tokens", (u) => u.output);
    kind("reasoning tokens (inside output)", (u) => u.reasoning);
    kind("cached input tokens (inside input)", (u) => u.cacheRead);
    row("agent minutes per delivery (all work / deliveries)", (a) =>
      number(a.costPerDelivery.agentMinutes),
    );
    row("end-to-end minutes per delivery", (a) => number(a.costPerDelivery.endToEndMinutes));
    row("tokens per delivery", (a) => number(a.costPerDelivery.tokens));
    lines.push("");
  };
  const gateTable = (gate, title) => {
    lines.push(`### ${title}`, "", "| item | holds | value |", "| --- | --- | --- |");
    for (const one of gate.items)
      lines.push(`| ${one.item} | ${one.holds ? "yes" : "no"} | ${one.value} |`);
    lines.push("");
  };
  lines.push(`Derived by analyzer ${analyzerDigest} (${analysisSchema}).`, "");
  lines.push(`## ${labelA}`, "");
  validityLines(stageA, shortA);
  if (stageA.validity.complete) {
    pairedTable(stageA.rows, "Launches");
    armTable(stageA.rows, "Per arm");
    const gateA =
      ruleFor(stageA.manifest) === "2026-10-15"
        ? stageAGate2026_10_15(stageA.rows, stageA.manifest.tasks, stageA.validity)
        : stageAGate(stageA.rows, stageA.manifest.tasks, stageA.validity);
    gateTable(
      gateA,
      `Stage A gate (${ruleFor(stageA.manifest)} rule): ${gateA.qualifies ? "qualifies" : "does not qualify"}`,
    );
  }
  if (stageB) {
    lines.push("## Stage B: the bugfix and feature repeated once per arm", "");
    validityLines(stageB, "Stage B");
    if (stageB.validity.complete && stageA.validity.complete) {
      pairedTable(stageB.rows, "Launches");
      armTable(stageB.rows, "Per arm");
      const all = [...stageA.rows, ...stageB.rows];
      armTable(
        all,
        "Combined descriptive view: four unique tasks, two of them repeated (12 launches)",
      );
      const gateB =
        ruleFor(stageA.manifest) === "2026-10-15"
          ? stageBGate2026_10_15(stageB.rows, all, stageB.validity)
          : stageBGate(stageB.rows, all, stageB.validity);
      gateTable(
        gateB,
        `Stage B gate (${ruleFor(stageA.manifest)} rule): ${gateB.proceeds ? "PROCEED TO A LARGER STUDY" : "DO NOT PROCEED"}`,
      );
    }
  }
  lines.push(
    "OpenCode's claim classification is a keyword heuristic over its final text; the text is kept in the analysis JSON beside each launch. Eligibility is derived from the records and the packaged blobs: the product's planned tests gate, prerequisite installs it printed, and the packaged gate runs of its sessions.",
    "",
  );
  return lines.join("\n");
}

/** The analysis as a document, with the evidence identity it was derived from. */
export function analysisOf(stageA, stageB) {
  const stage = (one) => ({
    evidenceRoot: one.root,
    manifestDigest: one.digest,
    validity: one.validity,
    halts: one.halts,
    recoveries: one.recoveries,
    rows: one.rows,
  });
  return {
    schema: analysisSchema,
    analyzerDigest,
    renderedAt: new Date().toISOString(),
    result:
      stageA.validity.complete && (stageB === null || stageB.validity.complete)
        ? "derived"
        : "incomplete",
    stageA: {
      ...stage(stageA),
      rule: ruleFor(stageA.manifest),
      gate: stageA.validity.complete
        ? ruleFor(stageA.manifest) === "2026-10-15"
          ? stageAGate2026_10_15(stageA.rows, stageA.manifest.tasks, stageA.validity)
          : stageAGate(stageA.rows, stageA.manifest.tasks, stageA.validity)
        : null,
    },
    stageB: stageB
      ? {
          ...stage(stageB),
          gate:
            stageB.validity.complete && stageA.validity.complete
              ? ruleFor(stageA.manifest) === "2026-10-15"
                ? stageBGate2026_10_15(
                    stageB.rows,
                    [...stageA.rows, ...stageB.rows],
                    stageB.validity,
                  )
                : stageBGate(stageB.rows, [...stageA.rows, ...stageB.rows], stageB.validity)
              : null,
        }
      : null,
  };
}

if (process.argv[1]?.endsWith("analyze.mjs")) {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 1) {
    const word = process.argv[index];
    if (word.startsWith("--")) args.set(word.slice(2), process.argv[index + 1] ?? "true");
  }
  if (!args.has("evidence")) {
    console.error(
      "usage: analyze.mjs --evidence <stage dir> [--evidence-b <stage dir>] [--out <json>] [--markdown <md>]",
    );
    process.exit(2);
  }
  const stageA = readStage(args.get("evidence"));
  const stageB = args.has("evidence-b") ? readStage(args.get("evidence-b")) : null;
  // A development stage is rendered under its own heading; the pilot's gate items still apply
  // literally to its rows and are read as such in the stage's report.
  const markdown = renderMarkdown(
    stageA,
    stageB,
    args.has("label") ? { a: args.get("label"), shortA: args.get("label") } : {},
  );
  const analysis = analysisOf(stageA, stageB);
  if (args.has("out")) writeFileSync(args.get("out"), `${JSON.stringify(analysis, null, 2)}\n`);
  if (args.has("markdown")) writeFileSync(args.get("markdown"), `${markdown}\n`);
  console.log(markdown);
  if (analysis.result !== "derived") {
    console.error(
      `incomplete evidence: ${[...stageA.validity.problems, ...(stageB?.validity.problems ?? [])].length} problem(s)`,
    );
    process.exit(1);
  }
}
