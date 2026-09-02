#!/usr/bin/env node
/**
 * Proves that a committed bundle's own verifier can say both yes and no.
 *
 * Two arms over one bundle. The reference arm runs the bundle's embedded verify.mjs against
 * the bundle as committed and expects exit 0. The tamper arm copies the bundle, changes one
 * digit of one record's timestamp, runs the same verifier over the copy, and expects it to be
 * refused with the hash chain named as the check that failed. A verifier that only ever says
 * yes has demonstrated nothing, which is why the second arm is not optional, and why its
 * failure has to be the expected one: a copy refused for some other reason is a different
 * defect rather than a proof.
 *
 * The transcript of both arms goes to stdout, so a workflow can keep it as an artifact.
 *
 *   node scripts/prove-bundle.mjs <bundle directory>
 *
 * Exit 0 when both arms behaved. Exit 1 when either did not, naming which and how.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Never the last record: a change there breaks only the chain head, and the proof wants the
 * link between two records to be what the verifier names. Any earlier record has one.
 */
export function chooseRecordToTamper(recordCount) {
  if (recordCount < 2) {
    throw new Error(
      `a ledger of ${recordCount} record(s) has no link to break: the tamper arm needs at least two`,
    );
  }
  return Math.floor((recordCount - 1) / 2);
}

/**
 * One byte, in a field the record's own hash covers and nothing about the run depends on. A
 * tamper does not have to be a lie about a result to be caught, and a reviewer who compared
 * only results would see nothing here. Bytes are handled as latin1 so the copy differs from
 * the original in exactly the one byte changed.
 */
export function flipOneTimestampDigit(ledgerBytes) {
  const lines = ledgerBytes.toString("latin1").split("\n");
  const recordLines = lines
    .map((line, lineIndex) => ({ line, lineIndex }))
    .filter((entry) => entry.line.length > 0);
  const recordIndex = chooseRecordToTamper(recordLines.length);
  const { line, lineIndex } = recordLines[recordIndex];

  const found = /"timestamp":(\d+)/.exec(line);
  if (found === null) {
    throw new Error(`record ${recordIndex} carries no timestamp to change`);
  }
  const at = found.index + '"timestamp":'.length + found[1].length - 1;
  const before = line[at];
  const after = before === "8" ? "7" : "8";
  lines[lineIndex] = line.slice(0, at) + after + line.slice(at + 1);

  return {
    ledgerBytes: Buffer.from(lines.join("\n"), "latin1"),
    recordIndex,
    before,
    after,
  };
}

/** What the verifier says when the record after the changed one no longer links to it. */
export function expectedChainFailure(recordIndex) {
  return `record ${recordIndex + 1} carries previousHash`;
}

/**
 * Both arms have to behave for the proof to hold. Each way they can fail is named separately,
 * because each wants a different response: a reference bundle that does not verify is a
 * broken artifact, a tampered copy that verifies is a verifier that cannot say no, and a copy
 * refused for a reason other than the chain is a verifier saying no for the wrong reason.
 */
export function judgeArms({ reference, tampered }) {
  const problems = [];
  if (reference.exitCode !== 0) {
    problems.push(
      `the reference bundle did not verify: its verifier exited ${reference.exitCode}`,
    );
  }
  if (tampered.exitCode === 0) {
    problems.push(
      `the tampered copy verified: one changed byte in record ${tampered.recordIndex} went ` +
        "unnoticed, so this verifier cannot say no",
    );
  } else if (!tampered.output.includes(expectedChainFailure(tampered.recordIndex))) {
    problems.push(
      "the tampered copy was refused, but not by the hash chain: expected " +
        `"${expectedChainFailure(tampered.recordIndex)}" in the transcript`,
    );
  }
  return { passed: problems.length === 0, problems };
}

/**
 * The verifier runs under an environment this script built rather than inherited, so nothing
 * named in the caller's shell decides what node loads into it. Same discipline as the
 * coverage arm, for the same reason.
 */
function verifierEnvironment() {
  const kept = {};
  for (const name of ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SystemRoot"]) {
    if (process.env[name] !== undefined) {
      kept[name] = process.env[name];
    }
  }
  return kept;
}

function runVerifier(bundle) {
  const spawned = spawnSync(process.execPath, [join(bundle, "verify.mjs"), bundle], {
    encoding: "utf8",
    env: verifierEnvironment(),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (spawned.error !== undefined) {
    throw spawned.error;
  }
  return { exitCode: spawned.status ?? 1, output: `${spawned.stdout}${spawned.stderr}` };
}

/** Runs both arms and writes the transcript through `log`, one line at a time. */
export function proveBundle(bundle, log) {
  log(`== reference arm: ${bundle} as committed ==`);
  const reference = runVerifier(bundle);
  log(reference.output.trimEnd());
  log(`verifier exited ${reference.exitCode}`);

  const scratch = mkdtempSync(join(tmpdir(), "swarm-tamper-"));
  try {
    const copy = join(scratch, "tampered");
    cpSync(bundle, copy, { recursive: true });
    const ledgerPath = join(copy, "ledger.jsonl");
    const flipped = flipOneTimestampDigit(readFileSync(ledgerPath));
    writeFileSync(ledgerPath, flipped.ledgerBytes);

    log("");
    log(
      `== tamper arm: a copy with record ${flipped.recordIndex} changed by one byte of its ` +
        `timestamp, ${flipped.before} -> ${flipped.after} ==`,
    );
    const tampered = runVerifier(copy);
    log(tampered.output.trimEnd());
    log(`verifier exited ${tampered.exitCode}`);

    const verdict = judgeArms({
      reference,
      tampered: { ...tampered, recordIndex: flipped.recordIndex },
    });
    log("");
    if (verdict.passed) {
      log("proof holds: the verifier accepted the bundle and refused the copy, naming the broken link");
    }
    for (const problem of verdict.problems) {
      log(`proof FAILED: ${problem}`);
    }
    return verdict;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.filename === process.argv[1]) {
  const bundle = process.argv[2];
  if (bundle === undefined) {
    console.error("usage: node scripts/prove-bundle.mjs <bundle directory>");
    process.exit(2);
  }
  const verdict = proveBundle(resolve(bundle), (line) => {
    console.log(line);
  });
  process.exit(verdict.passed ? 0 : 1);
}
