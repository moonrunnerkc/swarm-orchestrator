#!/usr/bin/env node
// Embedded bundle verifier for swarm-orchestrator evidence bundles.
//
// Dependency-free on purpose: it imports nothing outside node: builtins, so a reviewer can
// check a bundle on any Node 18+ machine without installing the tool that produced it. It
// recomputes every hash, every signature check, and every claim verdict from the bundle's
// own bytes. Nothing stated in the manifest or dag.json is taken on trust.
//
//   node verify.mjs <bundle directory>
//
// Exit code 0 means every check passed. Exit code 1 means at least one did not.

import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const GENESIS = "genesis";
const COMPARISONS = ["==", "!=", ">=", "<=", ">", "<"];

// One record type covers many subjects: every gate writes a gate-run, every tool writes a
// tool-call. A claim names the subject it asserts against, and this is how that name is
// recomputed here rather than read out of the bundle.
const SUBJECT_FIELD_BY_TYPE = {
  "gate-run": "gateId",
  "tool-call": "toolName",
  "attempt-selection": "taskId",
};

export function recordKindOf(type, payload) {
  const field = SUBJECT_FIELD_BY_TYPE[type];
  if (field === undefined) return type;
  if (payload === null || typeof payload !== "object") return type;
  const subject = payload[field];
  return typeof subject === "string" && subject.length > 0 ? `${type}:${subject}` : type;
}

/**
 * What a cited payload digest resolves to. Identical content is one blob by design, so two
 * writers can share a digest; what must not follow is that the citation means whichever of
 * them wrote last. The payload cannot differ between them, the kind can, so every record
 * carrying the digest is kept with the sequence that names it, and the claim says which one
 * it was bound to when it was submitted.
 */
export function indexCitedRecords(records, payloads) {
  const index = new Map();
  for (const entry of records) {
    if (!payloads.has(entry.payloadDigest)) continue;
    const payload = payloads.get(entry.payloadDigest);
    const carrier = { sequence: entry.sequence, kind: recordKindOf(entry.type, payload) };
    const found = index.get(entry.payloadDigest);
    if (found === undefined) {
      index.set(entry.payloadDigest, { carriers: [carrier], payload });
    } else {
      found.carriers.push(carrier);
    }
  }
  return index;
}

export function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number in canonical JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`;
}

function tokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "(" || character === ")") {
      tokens.push({ kind: "paren", text: character });
      index += 1;
      continue;
    }
    const pair = source.slice(index, index + 2);
    if (["&&", "||", "==", "!=", ">=", "<="].includes(pair)) {
      tokens.push({ kind: "operator", text: pair });
      index += 2;
      continue;
    }
    if (character === ">" || character === "<") {
      tokens.push({ kind: "operator", text: character });
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      const end = source.indexOf(character, index + 1);
      if (end === -1) throw new Error(`an opening ${character} is never closed`);
      tokens.push({ kind: "string", text: source.slice(index + 1, end) });
      index = end + 1;
      continue;
    }
    const remainder = source.slice(index);
    const number = /^-?\d+(?:\.\d+)?/.exec(remainder);
    if (number !== null) {
      tokens.push({ kind: "number", text: number[0] });
      index += number[0].length;
      continue;
    }
    const path = /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*/.exec(remainder);
    if (path !== null) {
      const text = path[0];
      tokens.push({ kind: ["true", "false", "null"].includes(text) ? "keyword" : "path", text });
      index += text.length;
      continue;
    }
    throw new Error(`"${character}" is not valid in a predicate`);
  }
  return tokens;
}

export function parsePredicate(source) {
  const tokens = tokenize(source);
  if (tokens.length === 0) throw new Error("the predicate is empty");
  let position = 0;

  const parseOperand = () => {
    const token = tokens[position];
    if (token === undefined) throw new Error("the predicate ends where a value was expected");
    position += 1;
    if (token.kind === "path")
      return { kind: "path", path: token.text.split("."), source: token.text };
    if (token.kind === "number") return { kind: "literal", value: Number(token.text) };
    if (token.kind === "string") return { kind: "literal", value: token.text };
    if (token.kind === "keyword") {
      return { kind: "literal", value: token.text === "null" ? null : token.text === "true" };
    }
    throw new Error(`"${token.text}" is not a value`);
  };

  const parseUnit = () => {
    const token = tokens[position];
    if (token !== undefined && token.text === "(") {
      position += 1;
      const inner = parseOr();
      if (tokens[position]?.text !== ")") throw new Error("an opening parenthesis is never closed");
      position += 1;
      return inner;
    }
    const left = parseOperand();
    const operator = tokens[position];
    if (
      operator === undefined ||
      operator.kind !== "operator" ||
      !COMPARISONS.includes(operator.text)
    ) {
      throw new Error("expected a comparison operator");
    }
    position += 1;
    return { kind: "compare", operator: operator.text, left, right: parseOperand() };
  };

  const parseAnd = () => {
    let node = parseUnit();
    while (tokens[position]?.text === "&&") {
      position += 1;
      node = { kind: "and", left: node, right: parseUnit() };
    }
    return node;
  };

  function parseOr() {
    let node = parseAnd();
    while (tokens[position]?.text === "||") {
      position += 1;
      node = { kind: "or", left: node, right: parseAnd() };
    }
    return node;
  }

  const node = parseOr();
  if (tokens[position] !== undefined) throw new Error("unexpected trailing input");
  return node;
}

function resolveOperand(operand, subject) {
  if (operand.kind === "literal") return { ok: true, value: operand.value };
  let current = subject;
  for (const segment of operand.path) {
    if (current === null || typeof current !== "object") {
      return {
        ok: false,
        failure: "path-not-found",
        detail: `${operand.source} does not exist in the cited record`,
      };
    }
    const next = Array.isArray(current) ? current[Number(segment)] : current[segment];
    if (next === undefined) {
      return {
        ok: false,
        failure: "path-not-found",
        detail: `${operand.source} does not exist in the cited record`,
      };
    }
    current = next;
  }
  return { ok: true, value: current };
}

function isPrimitive(value) {
  return value === null || typeof value !== "object";
}

function describeType(value) {
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}

function compare(operator, left, right) {
  if (operator === "==" || operator === "!=") {
    if (!isPrimitive(left) || !isPrimitive(right)) {
      return {
        ok: false,
        failure: "type-mismatch",
        detail: `${operator} compares primitives, and one side is an object or array`,
      };
    }
    const equal = left === right;
    return { ok: true, value: operator === "==" ? equal : !equal };
  }
  if (typeof left !== "number" || typeof right !== "number") {
    return {
      ok: false,
      failure: "type-mismatch",
      detail: `${operator} compares numbers, got ${describeType(left)} and ${describeType(right)}`,
    };
  }
  if (operator === ">=") return { ok: true, value: left >= right };
  if (operator === "<=") return { ok: true, value: left <= right };
  if (operator === ">") return { ok: true, value: left > right };
  return { ok: true, value: left < right };
}

// && and || evaluate both sides: a broken path never hides behind a false conjunction.
export function evaluatePredicate(node, subject) {
  if (node.kind === "and" || node.kind === "or") {
    const left = evaluatePredicate(node.left, subject);
    const right = evaluatePredicate(node.right, subject);
    if (!left.ok) return left;
    if (!right.ok) return right;
    return {
      ok: true,
      value: node.kind === "and" ? left.value && right.value : left.value || right.value,
    };
  }
  const left = resolveOperand(node.left, subject);
  if (!left.ok) return left;
  const right = resolveOperand(node.right, subject);
  if (!right.ok) return right;
  return compare(node.operator, left.value, right.value);
}

export function evaluateClaim(claim, lookup) {
  if (claim === null || typeof claim !== "object") {
    return {
      verdict: "unverified",
      reason: "record-not-found",
      detail: "the claim payload is missing",
    };
  }
  if (claim.record === null || claim.record === undefined) {
    return {
      verdict: "unverified",
      reason: "no-evidence-edge",
      detail: "the claim cites no record",
    };
  }
  const cited = lookup(claim.record);
  if (cited === undefined) {
    return {
      verdict: "unverified",
      reason: "record-not-found",
      detail: `no ledger record carries the payload digest ${claim.record}`,
    };
  }
  // Checked before the predicate: a predicate that is true of another kind of record is not
  // an honest near miss, it is a claim bound to the wrong evidence. The claim names the
  // record it was bound to at submission, so a later record reusing the digest under another
  // kind cannot reach back and withdraw a verdict that was honestly earned.
  const carriers = cited.carriers ?? [];
  const kinds = [...new Set(carriers.map((carrier) => carrier.kind))];
  if (claim.recordSequence === null) {
    return {
      verdict: "unverified",
      reason: "predicate-kind-mismatch",
      detail:
        kinds.length > 1
          ? `the digest ${claim.record} is carried by records of ${kinds.length} kinds (${kinds.join(", ")})`
          : "the harness bound this claim to no record when it was submitted",
    };
  }
  const bound =
    claim.recordSequence === undefined
      ? carriers[0]
      : carriers.find((carrier) => carrier.sequence === claim.recordSequence);
  if (bound === undefined) {
    return {
      verdict: "unverified",
      reason: "record-not-found",
      detail: `no record at sequence ${claim.recordSequence} carries the payload digest ${claim.record}`,
    };
  }
  if (bound.kind !== claim.recordKind) {
    return {
      verdict: "unverified",
      reason: "predicate-kind-mismatch",
      detail: `the claim asserts against ${claim.recordKind}, but the cited record is ${bound.kind}`,
    };
  }
  let node;
  try {
    node = parsePredicate(String(claim.predicate ?? ""));
  } catch (cause) {
    return { verdict: "unverified", reason: "predicate-unparseable", detail: cause.message };
  }
  const result = evaluatePredicate(node, cited.payload);
  if (!result.ok) return { verdict: "unverified", reason: result.failure, detail: result.detail };
  if (!result.value) {
    return {
      verdict: "unverified",
      reason: "predicate-false",
      detail: "the cited record does not support the predicate",
    };
  }
  return {
    verdict: "verified",
    reason: null,
    detail: "the predicate held against the cited record",
  };
}

/**
 * Every check for one bundle directory, without printing any of them. Split out so a combined
 * bundle can fold in its workers' checks: a worker chain is verified by exactly the same code
 * as the coordinator's, rather than by a second, looser reading of the same format.
 */
function collectChecks(directory) {
  const checks = [];
  const record = (name, ok, detail) => {
    checks.push({ name, ok, detail });
  };

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
    record(
      "manifest reads",
      true,
      `bundle format ${manifest.bundleFormat}, session ${manifest.sessionId}`,
    );
  } catch (cause) {
    record("manifest reads", false, cause.message);
    return { checks, verdicts: [], payloads: new Map(), manifest: null };
  }

  let lines = [];
  try {
    lines = readFileSync(join(directory, "ledger.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
  } catch (cause) {
    record("ledger reads", false, cause.message);
    return { checks, verdicts: [], payloads: new Map(), manifest };
  }

  const records = [];
  let parseFailures = 0;
  for (const [index, line] of lines.entries()) {
    try {
      records.push(JSON.parse(line));
    } catch (cause) {
      parseFailures += 1;
      record(`ledger line ${index + 1} parses`, false, cause.message);
    }
  }
  record("ledger parses", parseFailures === 0, `${records.length} of ${lines.length} lines`);
  record(
    "record count matches the manifest",
    records.length === manifest.recordCount,
    `${records.length} records, manifest says ${manifest.recordCount}`,
  );

  let previous = GENESIS;
  const chainProblems = [];
  for (const [index, entry] of records.entries()) {
    if (entry.sequence !== index) {
      chainProblems.push(`record ${index} declares sequence ${entry.sequence}`);
    }
    if (entry.previousHash !== previous) {
      chainProblems.push(
        `record ${index} carries previousHash ${entry.previousHash}, but the record before it hashes to ${previous}`,
      );
    }
    previous = sha256(canonicalJson(entry));
  }
  record(
    "hash chain intact",
    chainProblems.length === 0,
    chainProblems.join("; ") || `${records.length} links`,
  );
  record(
    "chain head matches the manifest",
    previous === manifest.chainHead,
    `computed ${previous}`,
  );

  let signatureOk = false;
  try {
    signatureOk = verifySignature(
      null,
      Buffer.from(manifest.chainHead, "utf8"),
      createPublicKey({
        key: Buffer.from(manifest.signature.publicKey, "base64"),
        format: "der",
        type: "spki",
      }),
      Buffer.from(manifest.signature.value, "base64"),
    );
  } catch (cause) {
    record("signature checks", false, cause.message);
  }
  record(
    "signature over the chain head verifies",
    signatureOk,
    `${manifest.signature.algorithm}, ${manifest.signature.keySource} key`,
  );

  const payloads = new Map();
  const blobProblems = [];
  let blobFiles = [];
  try {
    blobFiles = readdirSync(join(directory, "blobs"));
  } catch {
    blobFiles = [];
  }
  for (const file of blobFiles) {
    const bytes = readFileSync(join(directory, "blobs", file), "utf8");
    const digest = sha256(bytes);
    if (`${digest.replace("sha256:", "")}.json` !== file) {
      blobProblems.push(`${file} hashes to ${digest}`);
      continue;
    }
    try {
      payloads.set(digest, JSON.parse(bytes));
    } catch (cause) {
      blobProblems.push(`${file} is not JSON: ${cause.message}`);
    }
  }
  record(
    "blobs match their content addresses",
    blobProblems.length === 0,
    blobProblems.join("; ") || `${blobFiles.length} blobs`,
  );

  const missing = records
    .map((entry) => entry.payloadDigest)
    .filter((digest) => !payloads.has(digest));
  record(
    "every record's payload is present",
    missing.length === 0,
    missing.length === 0
      ? "all payloads resolve"
      : `${missing.length} missing: ${missing.join(", ")}`,
  );

  const cited = indexCitedRecords(records, payloads);
  const lookup = (digest) => cited.get(digest);
  const verdicts = records
    .filter((entry) => entry.type === "claim")
    .map((entry) => {
      const claim = payloads.get(entry.payloadDigest);
      return { sequence: entry.sequence, claim, evaluation: evaluateClaim(claim, lookup) };
    });

  const verified = verdicts.filter((entry) => entry.evaluation.verdict === "verified").length;
  record(
    "claim verdicts recomputed",
    manifest.claims.verified === verified,
    `${verified} verified, ${verdicts.length - verified} unverified; manifest says ${manifest.claims.verified} verified`,
  );

  return { checks, verdicts, payloads, manifest };
}

/** Does any payload in this bundle name that chain head? That is the coordinator's linkage. */
function namesChainHead(payloads, chainHead) {
  for (const payload of payloads.values()) {
    if (payload !== null && typeof payload === "object" && payload.chainHead === chainHead) {
      return true;
    }
  }
  return false;
}

export function verifyBundle(directory) {
  const top = collectChecks(directory);
  const checks = [...top.checks];
  const sections = [{ title: null, verdicts: top.verdicts }];

  for (const worker of top.manifest?.workers ?? []) {
    const label = `worker ${worker.workerId}`;
    const nested = collectChecks(join(directory, worker.directory));
    for (const check of nested.checks) {
      checks.push({ ...check, name: `${label}: ${check.name}` });
    }
    checks.push({
      name: `${label}: chain head matches the one this manifest lists`,
      ok: nested.manifest?.chainHead === worker.chainHead,
      detail: `listed ${worker.chainHead}, its own manifest says ${nested.manifest?.chainHead ?? "nothing"}`,
    });
    checks.push({
      name: `${label}: named by a coordinator record`,
      ok: namesChainHead(top.payloads, worker.chainHead),
      detail: namesChainHead(top.payloads, worker.chainHead)
        ? "a coordinator record carries this chain head"
        : "no coordinator record carries this chain head, so the signature says nothing about it",
    });
    sections.push({ title: label, verdicts: nested.verdicts });
  }

  for (const section of sections) {
    if (section.verdicts.length === 0) {
      continue;
    }
    console.log("");
    if (section.title !== null) {
      console.log(`  ${section.title}`);
    }
    for (const entry of section.verdicts) {
      const mark = entry.evaluation.verdict === "verified" ? "VERIFIED  " : "UNVERIFIED";
      const reason = entry.evaluation.reason === null ? "" : ` [${entry.evaluation.reason}]`;
      console.log(
        `  ${mark} record ${entry.sequence}: ${entry.claim?.predicate ?? "(no predicate)"}${reason}`,
      );
    }
  }

  return report(checks);
}

function report(checks) {
  console.log("");
  for (const check of checks) {
    console.log(
      `  ${check.ok ? "PASS" : "FAIL"}  ${check.name}${check.detail ? `: ${check.detail}` : ""}`,
    );
  }
  const failed = checks.filter((check) => !check.ok).length;
  console.log("");
  console.log(
    failed === 0
      ? "bundle verified: every check passed"
      : `bundle FAILED: ${failed} check(s) did not pass`,
  );
  return failed === 0 ? 0 : 1;
}

// Exported above so the project's own tests can check that this reimplementation agrees
// with the one in src/evidence. Importing the file must not run a verification.
// realpath first: on macOS the temp directory is a symlink, and the ESM loader reports the
// resolved path while argv does not.
const entry =
  process.argv[1] === undefined ? null : pathToFileURL(realpathSync(process.argv[1])).href;
if (entry === import.meta.url) {
  const target = process.argv[2] ?? ".";
  console.log(`verifying bundle at ${target}`);
  process.exitCode = verifyBundle(target);
}
