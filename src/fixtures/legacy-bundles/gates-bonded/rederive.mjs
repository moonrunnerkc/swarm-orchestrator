#!/usr/bin/env node
// Re-derivation for swarm-orchestrator evidence bundles.
//
// verify.mjs checks that a bundle is what it says it is. This script asks a harder question of
// the same bytes: would a third party, applying the rules this tool applies, reach the verdicts
// the bundle records? Every gate status is recomputed from the recorded exit code and output
// under the parser rule the record names; every ratchet decision is recomputed from the
// measures it recorded on each side; every bond verdict from its observation; every claim from
// its predicate and the record it cites; and the gate runs are held to the criteria sealed
// before the loop. Where a rule cannot be applied from the bundle alone, an inspection's own
// findings for one, or an output the record truncated, it says so by name rather than agreeing.
//
// Dependency-free, importing only node: builtins and verify.mjs beside it.
//
//   node rederive.mjs <bundle directory>
//
// Exit 0: every verdict that could be re-derived agrees with the recorded one. Exit 1: at
// least one disagrees, named. Verdicts that could not be re-derived are listed and do not
// decide the exit code, since an absence of re-derivation is not a disagreement.

import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  evaluateClaim,
  indexCitedRecords,
  recomputeBondVerdict,
  sealConformance,
  sha256,
} from "./verify.mjs";

const missingCommand = /command not found|:\s*not found|is not recognized as an internal/i;

function notApplicable(observation) {
  if (observation.unavailable !== null && observation.unavailable !== undefined)
    return "not-applicable";
  if (observation.exitCode === 127 || missingCommand.test(observation.stderr ?? ""))
    return "not-applicable";
  return null;
}

function counter(text, name) {
  const found = new RegExp(`^[#ℹ]\\s+${name}\\s+(\\d+)\\s*$`, "m").exec(text)?.[1];
  return found === undefined ? null : Number(found);
}

/**
 * The status the named parser rule reads out of an observation. Mirrors src/gates/parsers.ts
 * and src/gates/default-gates.ts, rule for rule; the parity test in that tree holds the two
 * to each other.
 */
export function readStatus(parser, observation) {
  const unavailable = notApplicable(observation);
  if (unavailable !== null) return unavailable;
  const stdout = observation.stdout ?? "";
  const stderr = observation.stderr ?? "";
  switch (parser) {
    case "exit-code":
      return observation.exitCode === 0 ? "passed" : "failed";
    case "no-output":
      if (observation.exitCode !== 0) return "failed";
      return stdout.trim().length === 0 ? "passed" : "failed";
    case "inspection":
      try {
        JSON.parse(stdout);
      } catch {
        return "failed";
      }
      return observation.exitCode === 0 ? "passed" : "failed";
    case "test-output": {
      const text = `${stdout}\n${stderr}`;
      if (/^TAP version \d+/m.test(text) || counter(text, "tests") !== null) {
        const plan = /^\s*1\.\.(\d+)\s*$/m.exec(text)?.[1];
        const tests = counter(text, "tests") ?? (plan === undefined ? null : Number(plan));
        const fail = counter(text, "fail");
        const failed = observation.exitCode !== 0 || (fail ?? 0) > 0;
        if (!failed && tests === 0) return "not-applicable";
        return failed ? "failed" : "passed";
      }
      const summary = /^\s*Tests\s+(.+?)\s*$/m.exec(text)?.[1] ?? "";
      if (/\(\d+\)/.test(summary)) {
        const failedCount = /(\d+)\s+failed/.exec(summary)?.[1];
        const failed = observation.exitCode !== 0 || Number(failedCount ?? 0) > 0;
        return failed ? "failed" : "passed";
      }
      return observation.exitCode === 0 ? "passed" : "failed";
    }
    default:
      return null;
  }
}

/**
 * The violations the ratchet's rules find in a decision's own before-and-after measures.
 * Assertions are compared only where no re-specification was cleared, because the allowance
 * a cleared specification earns is computed from the files and not recorded as a number.
 */
export function rederiveRatchet(payload) {
  const violations = [];
  const skipped = [];
  const before = payload.measures?.before ?? {};
  const after = payload.measures?.after ?? {};
  for (const [gateId, status] of Object.entries(payload.gates?.before ?? {})) {
    if (status !== "passed") continue;
    const now = payload.gates?.after?.[gateId];
    if (now === undefined) continue;
    if (now !== "passed") violations.push("gate-regressed");
  }
  if (after.testsDeclared < before.testsDeclared) violations.push("tests-declared-decreased");
  if (
    (payload.respecification ?? []).length === 0 &&
    (payload.newSpecifications ?? []).length === 0
  ) {
    if (after.assertions < before.assertions) violations.push("assertions-decreased");
  } else {
    skipped.push("assertions-decreased");
  }
  if (after.skipMarkers > before.skipMarkers) violations.push("skip-markers-increased");
  if (
    before.testsCollected !== null &&
    after.testsCollected !== null &&
    before.testsCollected !== undefined &&
    after.testsCollected !== undefined &&
    (payload.newSpecifications ?? []).length === 0 &&
    after.testsCollected < before.testsCollected
  ) {
    violations.push("tests-collected-decreased");
  }
  if (
    before.changedLineCoverage !== null &&
    after.changedLineCoverage !== null &&
    before.changedLineCoverage !== undefined &&
    after.changedLineCoverage !== undefined &&
    after.changedLineCoverage < before.changedLineCoverage
  ) {
    violations.push("changed-line-coverage-decreased");
  }
  return { violations: [...new Set(violations)], skipped };
}

function loadBundle(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  const records = readFileSync(join(directory, "ledger.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
  const payloads = new Map();
  for (const file of readdirSync(join(directory, "blobs"))) {
    const bytes = readFileSync(join(directory, "blobs", file), "utf8");
    payloads.set(sha256(bytes), JSON.parse(bytes));
  }
  let dag = null;
  try {
    dag = JSON.parse(readFileSync(join(directory, "dag.json"), "utf8"));
  } catch {
    dag = null;
  }
  return { manifest, records, payloads, dag };
}

export function rederiveBundle(directory, log = console.log) {
  const { manifest, records, payloads, dag } = loadBundle(directory);
  const lines = [];
  let disagreements = 0;
  let agreements = 0;
  let notRederived = 0;
  const say = (mark, text) => {
    lines.push(`  ${mark.padEnd(13)} ${text}`);
  };
  const agree = (text) => {
    agreements += 1;
    say("AGREES", text);
  };
  const disagree = (text) => {
    disagreements += 1;
    say("DISAGREES", text);
  };
  const cannot = (text) => {
    notRederived += 1;
    say("NOT RE-DERIVED", text);
  };

  const parserByGate = new Map();
  for (const entry of records) {
    if (entry.type !== "gate-run") continue;
    const payload = payloads.get(entry.payloadDigest);
    if (payload === undefined) {
      cannot(`gate-run ${entry.sequence}: payload missing`);
      continue;
    }
    const parser = payload.parser ?? "exit-code";
    const ruleNote =
      payload.parser === undefined ? " (rule not named in this record; exit-code assumed)" : "";
    parserByGate.set(payload.gateId, parser);
    if (payload.outputTruncated === true) {
      cannot(
        `gate-run ${entry.sequence} ${payload.gateId}: the record truncated the output the rule reads`,
      );
      continue;
    }
    const status = readStatus(parser, payload);
    if (status === null) {
      cannot(`gate-run ${entry.sequence} ${payload.gateId}: no rule named ${parser}`);
      continue;
    }
    if (status === payload.status) {
      agree(
        `gate-run ${entry.sequence} ${payload.gateId}: ${status} under the ${parser} rule${ruleNote}`,
      );
    } else {
      disagree(
        `gate-run ${entry.sequence} ${payload.gateId}: recorded ${payload.status}, the ${parser} rule reads ${status}`,
      );
    }
  }

  for (const entry of records) {
    if (entry.type !== "gate-bond") continue;
    const payload = payloads.get(entry.payloadDigest);
    if (payload === undefined) {
      cannot(`gate-bond ${entry.sequence}: payload missing`);
      continue;
    }
    if (payload.bond === null || payload.observed === null) {
      agree(
        `gate-bond ${entry.sequence} ${payload.gateId}: ${payload.verdict}, nothing observed to re-read`,
      );
      continue;
    }
    const parser = parserByGate.get(payload.gateId) ?? "exit-code";
    const observed = readStatus(parser, payload);
    const verdict = recomputeBondVerdict({ ...payload, observed });
    if (observed === payload.observed && verdict === payload.verdict) {
      agree(
        `gate-bond ${entry.sequence} ${payload.gateId}: ${observed} over the bond, so ${verdict}`,
      );
    } else {
      disagree(
        `gate-bond ${entry.sequence} ${payload.gateId}: recorded ${payload.observed} and ${payload.verdict}, the ${parser} rule reads ${observed} and ${verdict}`,
      );
    }
  }

  for (const entry of records) {
    if (entry.type !== "ratchet-decision") continue;
    const payload = payloads.get(entry.payloadDigest);
    if (payload === undefined) {
      cannot(`ratchet-decision ${entry.sequence}: payload missing`);
      continue;
    }
    const { violations, skipped } = rederiveRatchet(payload);
    const recorded = new Set((payload.violations ?? []).map((violation) => violation.kind));
    const missing = violations.filter((kind) => !recorded.has(kind));
    const extra = [...recorded].filter(
      (kind) => !violations.includes(kind) && !skipped.includes(kind),
    );
    const acceptedAgrees = payload.accepted === (recorded.size === 0);
    if (missing.length === 0 && extra.length === 0 && acceptedAgrees) {
      agree(
        `ratchet-decision ${entry.sequence} (${payload.scope}, attempt ${payload.attempt}): ${payload.accepted ? "accepted" : "rejected"}` +
          (violations.length > 0 ? `, ${violations.join(", ")}` : "") +
          (skipped.length > 0
            ? ` (${skipped.join(", ")} not re-derived: allowance not recorded as a number)`
            : ""),
      );
    } else {
      disagree(
        `ratchet-decision ${entry.sequence}: recorded ${[...recorded].join(", ") || "no violation"}, the measures give ${violations.join(", ") || "no violation"}` +
          (acceptedAgrees ? "" : `; accepted=${payload.accepted} does not follow from that`),
      );
    }
  }

  const cited = indexCitedRecords(records, payloads);
  const recordedVerdicts = new Map(
    (dag?.claims ?? []).map((claim) => [claim.sequence, claim.evaluation?.verdict]),
  );
  for (const entry of records) {
    if (entry.type !== "claim") continue;
    const claim = payloads.get(entry.payloadDigest);
    const evaluation = evaluateClaim(claim, (digest) => cited.get(digest));
    const recorded = recordedVerdicts.get(entry.sequence);
    if (recorded === undefined) {
      cannot(
        `claim ${entry.sequence}: dag.json records no verdict to compare with ${evaluation.verdict}`,
      );
    } else if (recorded === evaluation.verdict) {
      agree(`claim ${entry.sequence}: ${evaluation.verdict}`);
    } else {
      disagree(
        `claim ${entry.sequence}: dag.json says ${recorded}, the predicate over its record says ${evaluation.verdict}`,
      );
    }
  }

  const conformance = sealConformance(records, payloads);
  const gateRan = records.some((entry) => entry.type === "gate-run");
  if (conformance.sealed === null) {
    if ((manifest.bundleFormat ?? 1) >= 2 && gateRan) {
      disagree(
        "sealed criteria: bundle format 2 promises a seal before the gates ran, and none is recorded",
      );
    } else if (gateRan) {
      cannot("sealed criteria: none recorded, this bundle format predates sealing");
    } else {
      cannot("sealed criteria: no gate ran, so there is nothing to hold to a seal");
    }
  } else if (conformance.problems.length === 0) {
    agree(
      `sealed criteria: ${conformance.sealed.gates} gate(s) sealed at record ${conformance.sealed.sequence}, every gate run conforms`,
    );
  } else {
    disagree(`sealed criteria: ${conformance.problems.join("; ")}`);
  }

  log(`re-deriving verdicts in ${directory}`);
  log("");
  for (const line of lines) log(line);
  log("");
  log(
    disagreements === 0
      ? `every re-derived verdict agrees: ${agreements} agree, ${notRederived} could not be re-derived from the bundle alone`
      : `re-derivation FAILED: ${disagreements} verdict(s) disagree, ${agreements} agree, ${notRederived} could not be re-derived`,
  );
  return disagreements === 0 ? 0 : 1;
}

const entry =
  process.argv[1] === undefined ? null : pathToFileURL(realpathSync(process.argv[1])).href;
if (entry === import.meta.url) {
  process.exitCode = rederiveBundle(process.argv[2] ?? ".");
}
