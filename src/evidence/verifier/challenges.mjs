// The offline reading of a challenge verdict, independent of the module that produced it.
//
// A challenge verdict record says, per requirement, what challenging its checks established. This
// re-derives every one of those readings from the plan record written before anything ran, the
// completed run records between them, the base-control goal verification the verdict names, and
// the final goal verification of the candidate. It shares no code with `src/gates/goal-challenges.ts`;
// the two are held to the same cases by a parity test. Anything it cannot re-derive is named as
// such rather than agreed with.

/**
 * A requirement's status from its checks' statuses, by the goal verifier's rule.
 * @param {{checks: string[]}} requirement
 * @param {Array<{id: string, status: string}>} checks
 */
function requirementStatusOf(requirement, checks) {
  const statuses = requirement.checks.map(
    (id) => checks.find((check) => check.id === id)?.status ?? "unjudged",
  );
  if (statuses.length === 0 || statuses.includes("unjudged")) return "unjudged";
  return statuses.every((status) => status === "accepted") ? "accepted" : "rejected";
}

function baseControlOf(requirementId, base, presetKind) {
  if (base === null || base === undefined) return "not-run";
  const obligation = (base.obligations ?? []).find((entry) => entry.id === requirementId);
  if (obligation === undefined || obligation.status === "unjudged") return "unavailable";
  if (obligation.status === "rejected") return "discriminates";
  return presetKind === "refactor" ? "preserved" : "vacuous";
}

const invalidParses = new Set(["not-applied", "syntax-error", "dialect-unreadable"]);

/**
 * The requirement outcome from the observations, the same rule the producer applies.
 * @returns {{outcome: string, caught: string[], gaps: string[], unwitnessed: string[], invalid: string[]}}
 */
export function readChallengeOutcome(input) {
  const { requirement } = input;
  const caught = [];
  const gaps = [];
  const unwitnessed = [];
  const invalid = [];
  for (const one of input.alternatives) {
    const relevant = one.kind === "mutant" || one.fixture?.requirement === requirement.id;
    if (!relevant) continue;
    if (invalidParses.has(one.parse)) {
      if (one.kind === "fixture") invalid.push(one.id);
      continue;
    }
    const status =
      (one.requirements ?? []).find((entry) => entry.id === requirement.id)?.status ?? "unjudged";
    if (status === "rejected") caught.push(one.id);
    else if (status === "unjudged") invalid.push(one.id);
    else if (one.witness === "repository-suite" || one.witness === "declared-fixture")
      gaps.push(one.id);
    else unwitnessed.push(one.id);
  }
  const outcome =
    requirement.checks.length === 0
      ? "gap"
      : input.candidate === "unjudged"
        ? "invalid-evidence"
        : input.baseControl === "vacuous"
          ? "gap"
          : gaps.length > 0
            ? "gap"
            : invalid.length > 0
              ? "invalid-evidence"
              : caught.length > 0 &&
                  (input.baseControl === "discriminates" || input.baseControl === "preserved")
                ? "detected"
                : "unjudged";
  return { outcome, caught, gaps, unwitnessed, invalid };
}

/**
 * Every challenge verdict in the record, each re-derived or named as not re-derivable.
 * @param {Array<{sequence: number, type: string, payloadDigest: string}>} records
 * @param {Map<string, any>} payloads
 * @returns {Array<{sequence: number, agrees: boolean, problems: string[]}>}
 */
export function challengeVerdictsAgree(records, payloads) {
  const findings = [];
  const commands = records.filter((entry) => entry.type === "verification-command");
  for (const entry of commands) {
    const verdict = payloads.get(entry.payloadDigest);
    if (verdict?.rule !== "challenge-verdict-v1") continue;
    const problems = [];
    const plan = commands.find(
      (candidate) =>
        candidate.sequence < entry.sequence && candidate.payloadDigest === verdict.plan,
    );
    const planned = payloads.get(plan?.payloadDigest);
    if (planned?.rule !== "challenge-plan-v1" || planned.contractDigest !== verdict.contractDigest)
      problems.push("the verdict names no plan written before it for this contract");
    if (planned?.policy !== verdict.policy)
      problems.push("the plan and the verdict disagree on the policy");
    const declaration = records.find(
      (candidate) =>
        candidate.type === "goal-contract" &&
        candidate.sequence < entry.sequence &&
        payloads.get(candidate.payloadDigest)?.digest === verdict.contractDigest,
    );
    const contract = payloads.get(declaration?.payloadDigest)?.contract;
    if (contract === undefined)
      problems.push("the contract the verdict names is not on the chain before it");
    const runs = commands
      .filter(
        (candidate) =>
          candidate.sequence > (plan?.sequence ?? Number.MAX_SAFE_INTEGER) &&
          candidate.sequence < entry.sequence,
      )
      .map((candidate) => payloads.get(candidate.payloadDigest))
      .filter((payload) => payload?.rule === "challenge-run-v1" && payload.plan === verdict.plan);
    const completed = runs.filter((run) => run.phase === "completed");
    const intents = runs.filter((run) => run.phase === "intent");
    if (completed.length !== (verdict.alternatives ?? []).length)
      problems.push(
        `${completed.length} completed run(s) on the chain, ${(verdict.alternatives ?? []).length} in the verdict`,
      );
    for (const one of completed) {
      if (!intents.some((intent) => intent.id === one.id))
        problems.push(`run ${one.id} completed with no intent before it`);
      const declared = (verdict.alternatives ?? []).find(
        (alternative) => alternative.id === one.id,
      );
      if (declared === undefined) problems.push(`run ${one.id} is not in the verdict`);
      else if (JSON.stringify(declared.requirements) !== JSON.stringify(one.requirements))
        problems.push(
          `run ${one.id} recorded different requirement statuses than the verdict carries`,
        );
      if (one.kind === "mutant" && !(planned?.mutants ?? []).includes(one.id))
        problems.push(`mutant ${one.id} was not in the plan`);
      if (
        one.kind === "fixture" &&
        !(planned?.fixtures ?? []).some((fixture) => fixture.id === one.id)
      )
        problems.push(`fixture ${one.id} was not in the plan`);
    }
    // The base control the verdict names, as the goal verifier recorded it.
    const base =
      verdict.baseTree === null
        ? null
        : (records
            .filter(
              (candidate) =>
                candidate.type === "goal-verification" && candidate.sequence < entry.sequence,
            )
            .map((candidate) => payloads.get(candidate.payloadDigest))
            .find(
              (payload) =>
                payload?.tree === verdict.baseTree &&
                payload?.contractDigest === verdict.contractDigest,
            ) ?? undefined);
    if (base === undefined) problems.push("the base control the verdict names is not on the chain");
    const candidate = records
      .filter(
        (candidate) =>
          candidate.type === "goal-verification" && candidate.sequence < entry.sequence,
      )
      .map((candidate) => payloads.get(candidate.payloadDigest))
      .filter(
        (payload) =>
          payload?.contractDigest === verdict.contractDigest && payload?.tree !== verdict.baseTree,
      )
      .at(-1);
    if (candidate === undefined)
      problems.push("no candidate goal verification precedes the verdict");
    if (contract !== undefined && problems.length === 0) {
      const presetKind = contract.preset?.kind;
      for (const requirement of contract.requirements) {
        const recorded = (verdict.requirements ?? []).find((entry) => entry.id === requirement.id);
        const reading = readChallengeOutcome({
          requirement,
          candidate:
            candidate.obligations.find((entry) => entry.id === requirement.id)?.status ??
            "unjudged",
          baseControl: baseControlOf(requirement.id, base, presetKind),
          alternatives: completed,
        });
        if (recorded === undefined)
          problems.push(`requirement ${requirement.id} is missing from the verdict`);
        else if (
          recorded.outcome !== reading.outcome ||
          JSON.stringify(recorded.caught) !== JSON.stringify(reading.caught) ||
          JSON.stringify(recorded.gaps) !== JSON.stringify(reading.gaps)
        )
          problems.push(
            `requirement ${requirement.id}: recorded ${recorded.outcome}, the observations read ${reading.outcome}`,
          );
      }
      const satisfied = (verdict.requirements ?? []).every((entry) => entry.outcome === "detected");
      if (verdict.satisfied !== satisfied)
        problems.push("satisfied disagrees with the requirement outcomes");
    }
    findings.push({ sequence: entry.sequence, agrees: problems.length === 0, problems });
  }
  return findings;
}
