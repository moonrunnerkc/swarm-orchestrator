import { createHash } from "node:crypto";

// Check strengthening, re-derived from the chain. An additive check is admitted to a requirement
// only on the harness's own observations: under its one-check probe contract it rejects the
// counterexample that exposed the gap and accepts every sealed reference for the requirement.
// A revision appends admitted checks to its parent and changes nothing else. Mirrors
// `admissionDecision` in src/gates/check-admission.ts and `revisionProblem` in
// src/evidence/goal-contract.ts, written again so the decision a record carries is checked by a
// second implementation rather than by the code that made it. Dependency-free.

function canonicalText(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalText).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalText(v)}`).join(",")}}`;
}

function digestOf(value) {
  return `sha256:${createHash("sha256").update(canonicalText(value), "utf8").digest("hex")}`;
}

/** The admission rule over recorded runs. Mirrors `admissionDecision`. */
export function readAdmission(runs, references) {
  const reasons = [];
  const counterexample = runs.filter((run) => run.purpose === "counterexample");
  if (counterexample.length !== 1) reasons.push("the counterexample was not run exactly once");
  else if (counterexample[0].status !== "rejected")
    reasons.push(
      `the check did not reject the counterexample (${counterexample[0].status}), so it does not detect the fault that exposed the gap`,
    );
  if (references.length === 0)
    reasons.push(
      "no sealed reference implementation for this requirement, so nothing justifies what the check expects of correct code",
    );
  for (const reference of references) {
    const run = runs.filter((one) => one.purpose === "reference" && one.reference === reference);
    if (run.length !== 1) reasons.push(`reference ${reference} was not run exactly once`);
    else if (run[0].status !== "accepted")
      reasons.push(
        `reference ${reference} is ${run[0].status}, so the check rejects work the contract's author vouches is correct`,
      );
  }
  if (runs.filter((run) => run.purpose === "candidate").length !== 1)
    reasons.push("the candidate was not run exactly once");
  return { admitted: reasons.length === 0, reasons };
}

/** Why a revision is not its parent with only the admitted checks appended; null where it is. */
export function readRevision(parent, revised, admitted) {
  const { requirements: parentRequirements, checks: parentChecks, ...parentRest } = parent;
  const { requirements: revisedRequirements, checks: revisedChecks, ...revisedRest } = revised;
  if (canonicalText(parentRest) !== canonicalText(revisedRest))
    return "the revision changes the contract beyond its requirement checks";
  if (revisedRequirements.length !== parentRequirements.length)
    return "the revision adds or removes a requirement";
  for (let index = 0; index < parentRequirements.length; index++) {
    const original = parentRequirements[index];
    const next = revisedRequirements[index];
    const added = admitted
      .filter((one) => one.requirement === original.id)
      .map((one) => one.check.id);
    if (
      next === undefined ||
      next.id !== original.id ||
      next.description !== original.description ||
      canonicalText(next.checks) !== canonicalText([...original.checks, ...added])
    )
      return `requirement ${original.id} is not its original with only the admitted checks appended`;
  }
  const expected = [...parentChecks, ...admitted.map((one) => one.check)];
  if (canonicalText(revisedChecks) !== canonicalText(expected))
    return "the revision's checks are not the original checks followed by the admitted ones";
  return null;
}

/**
 * Every admission and every revision on the chain, re-derived or named as not re-derivable.
 * @param {Array<{sequence: number, type: string, payloadDigest: string}>} records
 * @param {Map<string, any>} payloads
 * @returns {Array<{sequence: number, agrees: boolean, problems: string[]}>}
 */
export function strengtheningAgrees(records, payloads) {
  const findings = [];
  const contracts = new Map();
  for (const entry of records) {
    if (entry.type !== "goal-contract") continue;
    const payload = payloads.get(entry.payloadDigest);
    if (payload?.digest !== undefined && !contracts.has(payload.digest))
      contracts.set(payload.digest, { sequence: entry.sequence, payload });
  }
  const admissions = new Map();
  const requirementAdmissions = new Map();
  for (const entry of records) {
    if (entry.type !== "verification-command") continue;
    const payload = payloads.get(entry.payloadDigest);
    if (payload?.rule !== "check-admission-v1" || payload.phase !== "completed") continue;
    const problems = [];
    const probe = contracts.get(payload.probe);
    if (probe === undefined || probe.sequence > entry.sequence)
      problems.push("the probe contract is not on the chain before the admission");
    else {
      const lineage = probe.payload.lineage;
      if (
        lineage?.role !== "admission-probe" ||
        lineage.proposal !== payload.proposal ||
        lineage.requirement !== payload.requirement
      )
        problems.push("the probe does not name this proposal and requirement");
      const parent = contracts.get(lineage?.parent);
      const source = parent?.payload.contract.requirements.find(
        (one) => one.id === payload.requirement,
      );
      const contract = probe.payload.contract;
      if (
        digestOf(contract) !== payload.probe ||
        source === undefined ||
        contract.requirements.length !== 1 ||
        contract.requirements[0].id !== source.id ||
        contract.requirements[0].description !== source.description ||
        canonicalText(contract.checks) !== canonicalText([payload.check])
      )
        problems.push("the probe contract is not the requirement with the proposed check alone");
      const expectedReferences = (parent?.payload.contract.challenges?.references ?? [])
        .filter((reference) => reference.requirement === payload.requirement)
        .map((reference) => reference.id);
      if (canonicalText(expectedReferences) !== canonicalText(payload.references ?? []))
        problems.push("the admission ran other references than the contract seals");
    }
    for (const run of payload.runs ?? []) {
      const written = records.find(
        (candidate) =>
          candidate.type === "goal-verification" &&
          candidate.sequence < entry.sequence &&
          candidate.payloadDigest === run.verification,
      );
      const verification = payloads.get(written?.payloadDigest);
      const status =
        written === undefined ? "unjudged" : (verification?.obligations?.[0]?.status ?? "unjudged");
      if (written !== undefined && verification?.contractDigest !== payload.probe)
        problems.push(`the ${run.purpose} run cites a verification of another contract`);
      if (status !== run.status)
        problems.push(
          `the ${run.purpose} run records ${run.status}; its verification reads ${status}`,
        );
    }
    const derived = readAdmission(payload.runs ?? [], payload.references ?? []);
    if (derived.admitted !== payload.admitted)
      problems.push(
        `recorded ${payload.admitted ? "admitted" : "refused"}, the rule reads ${derived.admitted ? "admitted" : "refused"}`,
      );
    if (payload.admitted) {
      admissions.set(entry.payloadDigest, payload);
      requirementAdmissions.set(
        payload.requirement,
        (requirementAdmissions.get(payload.requirement) ?? 0) + 1,
      );
    }
    findings.push({ sequence: entry.sequence, agrees: problems.length === 0, problems });
  }
  for (const [digest, { sequence, payload }] of contracts) {
    if (payload.lineage?.role !== "revision") continue;
    const problems = [];
    const parent = contracts.get(payload.lineage.parent);
    if (parent === undefined || parent.sequence > sequence)
      problems.push("the revision's parent is not on the chain before it");
    const admitted = [];
    for (const record of payload.lineage.admissions ?? []) {
      const admission = admissions.get(record);
      if (admission === undefined)
        problems.push(`admission ${record} is not an admitted check on the chain`);
      else admitted.push({ requirement: admission.requirement, check: admission.check });
    }
    if (digestOf(payload.contract) !== digest)
      problems.push("the revision's digest does not match its contract");
    if (parent !== undefined && problems.length === 0) {
      const problem = readRevision(parent.payload.contract, payload.contract, admitted);
      if (problem !== null) problems.push(problem);
    }
    findings.push({ sequence, agrees: problems.length === 0, problems });
  }
  const plan = records
    .filter((entry) => entry.type === "verification-command")
    .map((entry) => payloads.get(entry.payloadDigest))
    .find((payload) => payload?.rule === "strengthening-plan-v1");
  if (plan !== undefined)
    for (const [requirement, count] of requirementAdmissions)
      if (count > plan.perRequirement)
        findings.push({
          sequence: -1,
          agrees: false,
          problems: [
            `requirement ${requirement} has ${count} admitted checks; the plan allows ${plan.perRequirement}`,
          ],
        });
  return findings;
}
