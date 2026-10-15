/**
 * Read-only analysis of the pilot's launch records, by the pilot's own decision rules. Nothing
 * here launches, rewrites or scores a tree; it reads the records the comparison runner wrote
 * and the stdout blobs they cite, and keeps a correct patch apart from a delivered task:
 *
 * - correct patch: the hidden oracle passed the final tree;
 * - correctly delivered: a correct patch, the visible checks resolved, the product finished
 *   normally within its budget (exit 0, not killed at the wall), and reported completion
 *   without contradiction; for Swarm, also its own acceptable verdict, evidence present and no
 *   oracle exposure; for OpenCode, a final answer that reads as a completion claim under the
 *   keyword heuristic below, which is a heuristic and is reported beside the text it read.
 *
 * Costs are over every launch, failed work included; a cost per delivery with zero deliveries
 * is undefined, never zero. Token totals are the arms' own accounts and are not comparable
 * with precision: Swarm's events sum what the provider reported as input and output per step,
 * OpenCode's step-finish parts carry input, output, reasoning and cache fields; both are shown
 * and neither is adjusted.
 *
 *   node scripts/pilot/analyze.mjs --manifest <stage A> [--manifest-b <stage B>] [--out <json>] [--markdown <md>]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { digestOf, swarmResult } from "../comparison/arms.mjs";
import { comparisonRoot } from "../comparison/workspace.mjs";

/**
 * A launch record's file name, as `scripts/comparison/analyze.mjs` defines it. Spelled here
 * rather than imported: that module runs its command-line block whenever the entry script is
 * named analyze.mjs, which this one is.
 */
export const isLaunchRecord = (name) =>
  /^[a-z][a-z0-9-]*\.(swarm|opencode)\.(json|(infrastructure|halted)-\d+\.json)$/.test(name);

const blobs = join(comparisonRoot, "blobs");
const blob = (digest) => {
  const path = join(blobs, digest.slice(7));
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};

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
  };
}

function classifyClaim(record, lastStdout) {
  const last = record.invocations.at(-1);
  if (!last) return { claim: "no-invocation", basis: "nothing ran" };
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

export function analyzeRecord(record) {
  const last = record.invocations.at(-1) ?? null;
  const lastStdout = last ? blob(last.stdoutDigest) : null;
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
  return {
    task: record.task,
    arm: record.arm,
    order: record.order,
    valid: record.infrastructureFailure === null && !record.halt && !exposure,
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
          ? record.invocations.some((one) => (one.tokens ?? 0) >= 600_000)
          : null,
    },
    notes: record.notes,
    finalPatchDigest: record.finalPatchDigest,
    finalPatchBytes: record.finalPatchBytes,
  };
}

const sum = (rows, pick) => rows.reduce((total, row) => total + (pick(row) ?? 0), 0);

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
    correctPatches: rows.filter((row) => row.correctPatch).length,
    deliveries: delivered.length,
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
    costPerDelivery: {
      agentMinutes: perDelivery(sum(rows, (row) => row.time.agentMs) / 60_000),
      endToEndMinutes: perDelivery(sum(rows, (row) => row.time.elapsedMs) / 60_000),
      tokens: allTokensKnown
        ? perDelivery(sum(rows, (row) => row.tokens.total))
        : "not precise: usage unknown for some launch",
    },
  };
}

/** The frozen Stage A gate, item by item, each with the value it was decided on. */
export function stageAGate(rows, tasks) {
  const swarm = rows.filter((row) => row.arm === "swarm");
  const opencode = rows.filter((row) => row.arm === "opencode");
  const byType = (type) => tasks.find((task) => task.workType === type)?.id;
  const deliveredIds = new Set(swarm.filter((row) => row.delivered).map((row) => row.task));
  const items = [];
  items.push({
    item: "eight valid, inspectable launches; no unresolved setup/scoring problem; no exposure",
    holds: rows.length === 8 && rows.every((row) => row.valid),
    value: `${rows.filter((row) => row.valid).length} valid of ${rows.length} recorded`,
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
    value: `${swarm.filter((row) => row.falseClaim).length} false claim(s); max agent time ${Math.max(0, ...swarm.map((row) => row.time.agentMs)) / 60_000} min; manual involvement: none recorded by the launcher`,
  });
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
    s.deliveries === o.deliveries && s.elapsedMs <= 0.8 * o.elapsedMs && correctionsNoWorse;
  items.push({
    item: "comparative benefit: Swarm delivers more; or the same number with at least 20% less end-to-end time over the four tasks and no more corrections on tasks both deliver",
    holds: s.deliveries > o.deliveries || timeRoute,
    value: `deliveries swarm ${s.deliveries} vs opencode ${o.deliveries}; end-to-end ${(s.elapsedMs / 60_000).toFixed(1)} vs ${(o.elapsedMs / 60_000).toFixed(1)} min; corrections no worse on the ${both.length} task(s) both deliver: ${correctionsNoWorse}`,
  });
  return { items, qualifies: items.every((one) => one.holds) };
}

export function stageBGate(rowsB, rowsAll) {
  const swarmB = rowsB.filter((row) => row.arm === "swarm");
  const items = [];
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
  const s = armSummary(rowsAll.filter((row) => row.arm === "swarm"));
  const o = armSummary(rowsAll.filter((row) => row.arm === "opencode"));
  items.push({
    item: "the same comparative-benefit rule on the combined descriptive results",
    holds:
      s.deliveries > o.deliveries ||
      (s.deliveries === o.deliveries && s.elapsedMs <= 0.8 * o.elapsedMs),
    value: `deliveries swarm ${s.deliveries} vs opencode ${o.deliveries}; end-to-end ${(s.elapsedMs / 60_000).toFixed(1)} vs ${(o.elapsedMs / 60_000).toFixed(1)} min`,
  });
  return { items, proceeds: items.every((one) => one.holds) };
}

export function readStage(manifestPath) {
  const bytes = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(bytes);
  const digest = digestOf(bytes);
  const runs = join(comparisonRoot, "runs", digest.slice(7, 23));
  const names = existsSync(runs) ? readdirSync(runs).sort() : [];
  const records = names
    .filter(isLaunchRecord)
    .map((name) => ({ name, ...JSON.parse(readFileSync(join(runs, name), "utf8")) }));
  const halts = names.filter((name) => /^halt-\d+\.json$/.test(name));
  const recoveries = names.filter((name) => /^recovery-\d+\.json$/.test(name));
  return { manifest, digest, runs, records, halts, recoveries, rows: records.map(analyzeRecord) };
}

const minutes = (ms) => `${(ms / 60_000).toFixed(1)} min`;
const number = (value) =>
  typeof value === "number"
    ? value.toLocaleString("en-US", { maximumFractionDigits: 1 })
    : String(value);

export function renderMarkdown(stageA, stageB) {
  const lines = [];
  const pairedTable = (rows, title) => {
    lines.push(
      `### ${title}`,
      "",
      "| task | arm | correct patch | delivered | corrections | claim | agent | end-to-end | tokens | why not delivered |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const row of [...rows].sort((a, b) => a.order - b.order))
      lines.push(
        `| ${row.task} | ${row.arm} | ${row.correctPatch ? "yes" : "no"} | ${row.delivered ? "yes" : "no"} | ${row.corrections} | ${row.claim} | ${minutes(row.time.agentMs)} | ${minutes(row.time.elapsedMs)} | ${row.tokens.total === null ? "unknown" : row.tokens.total.toLocaleString("en-US")}${row.tokens.unknownInvocations ? ` (+${row.tokens.unknownInvocations} unknown)` : ""} | ${row.notDeliveredBecause.join("; ") || ""} |`,
      );
    lines.push("");
  };
  const armTable = (rows, title) => {
    const s = armSummary(rows.filter((row) => row.arm === "swarm"));
    const o = armSummary(rows.filter((row) => row.arm === "opencode"));
    lines.push(`### ${title}`, "", "| measure | swarm | opencode |", "| --- | --- | --- |");
    const row = (label, pick) => lines.push(`| ${label} | ${pick(s)} | ${pick(o)} |`);
    row("launches recorded (valid)", (a) => `${a.launches} (${a.valid})`);
    row("correct patches", (a) => `${a.correctPatches}`);
    row("correctly delivered", (a) => `${a.deliveries}`);
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
  lines.push("## Stage A: four fresh tasks, one launch per arm", "");
  lines.push(
    `Manifest \`${stageA.digest}\`; ${stageA.records.length} of ${stageA.manifest.launches.length} launches recorded; halts ${stageA.halts.length}, recoveries ${stageA.recoveries.length}.`,
    "",
  );
  pairedTable(stageA.rows, "Launches");
  armTable(stageA.rows, "Per arm");
  const gateA = stageAGate(stageA.rows, stageA.manifest.tasks);
  gateTable(gateA, `Stage A gate: ${gateA.qualifies ? "qualifies" : "does not qualify"}`);
  if (stageB) {
    lines.push("## Stage B: the bugfix and feature repeated once per arm", "");
    lines.push(
      `Manifest \`${stageB.digest}\`; ${stageB.records.length} of ${stageB.manifest.launches.length} launches recorded; halts ${stageB.halts.length}, recoveries ${stageB.recoveries.length}.`,
      "",
    );
    pairedTable(stageB.rows, "Launches");
    armTable(stageB.rows, "Per arm");
    const all = [...stageA.rows, ...stageB.rows];
    armTable(
      all,
      "Combined descriptive view: four unique tasks, two of them repeated (12 launches)",
    );
    const gateB = stageBGate(stageB.rows, all);
    gateTable(
      gateB,
      `Stage B gate: ${gateB.proceeds ? "PROCEED TO A LARGER STUDY" : "DO NOT PROCEED"}`,
    );
  }
  lines.push(
    "OpenCode's claim classification is a keyword heuristic over its final text; the text is kept in the analysis JSON beside each launch.",
    "",
  );
  return lines.join("\n");
}

if (process.argv[1]?.endsWith("analyze.mjs")) {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 1) {
    const word = process.argv[index];
    if (word.startsWith("--")) args.set(word.slice(2), process.argv[index + 1] ?? "true");
  }
  const stageA = readStage(args.get("manifest"));
  const stageB = args.has("manifest-b") ? readStage(args.get("manifest-b")) : null;
  const markdown = renderMarkdown(stageA, stageB);
  const analysis = {
    schema: "swarm-real-task-pilot.analysis.v1",
    renderedAt: new Date().toISOString(),
    stageA: {
      manifestDigest: stageA.digest,
      runs: stageA.runs,
      halts: stageA.halts,
      recoveries: stageA.recoveries,
      rows: stageA.rows,
      gate: stageAGate(stageA.rows, stageA.manifest.tasks),
    },
    stageB: stageB
      ? {
          manifestDigest: stageB.digest,
          runs: stageB.runs,
          halts: stageB.halts,
          recoveries: stageB.recoveries,
          rows: stageB.rows,
          gate: stageBGate(stageB.rows, [...stageA.rows, ...stageB.rows]),
        }
      : null,
  };
  if (args.has("out")) writeFileSync(args.get("out"), `${JSON.stringify(analysis, null, 2)}\n`);
  if (args.has("markdown")) writeFileSync(args.get("markdown"), `${markdown}\n`);
  console.log(markdown);
}
