import type { Eligibility } from "./capacity.ts";
import type { InstalledModel } from "./ollama.ts";
import type { ProbeResult } from "./probe.ts";
import type { Profile } from "./profile.ts";

export interface Candidate {
  readonly eligibility: Eligibility;
  readonly probe: ProbeResult;
}

export interface Choice {
  readonly chosen: Candidate;
  /** One line: why this model. */
  readonly reason: string;
  /** Every other ready model, best first: what an escalation may choose among, by record. */
  readonly alternatives: readonly Candidate[];
}

const gib = 1024 ** 3;

/** Finished tasks recorded for a model, where there are enough to rank by. */
function completionRate(profile: Profile, digest: string): number | null {
  const outcome = profile.outcomes[digest];
  if (outcome === undefined || outcome.complete + outcome.other < 3) return null;
  return outcome.complete / (outcome.complete + outcome.other);
}

/**
 * The share of finished tasks a model is expected to complete: its record where three or more
 * are recorded, otherwise an even prior, so a model that keeps failing ranks below one not tried.
 */
function expectedRate(profile: Profile, digest: string): number {
  return completionRate(profile, digest) ?? 0.5;
}

/**
 * Ready candidates, best first: by the share of finished tasks that ended complete where at
 * least three are recorded (an even prior otherwise), then by parameter count, then by measured
 * throughput, then by name. Without outcomes the order is a conservative default, and the reason
 * says so.
 */
export function rank(candidates: readonly Candidate[], profile: Profile): Candidate[] {
  const ready = candidates.filter((one) => one.probe.ready && one.eligibility.eligible);
  return [...ready].sort((a, b) => {
    const rateA = expectedRate(profile, a.eligibility.model.digest);
    const rateB = expectedRate(profile, b.eligibility.model.digest);
    if (rateA !== rateB) return rateB - rateA;
    const sizeA = a.eligibility.model.parameters ?? 0;
    const sizeB = b.eligibility.model.parameters ?? 0;
    if (sizeA !== sizeB) return sizeB - sizeA;
    const speed = (b.probe.tokensPerSecond ?? 0) - (a.probe.tokensPerSecond ?? 0);
    // Equal on every measure: the name decides, so the same machine always picks the same model.
    return speed !== 0 ? speed : a.eligibility.model.name.localeCompare(b.eligibility.model.name);
  });
}

export function choose(
  candidates: readonly Candidate[],
  profile: Profile,
  contextTokens: number,
): Choice | null {
  const ranked = rank(candidates, profile);
  const [chosen] = ranked;
  if (chosen === undefined) return null;
  const model = chosen.eligibility.model;
  const need = chosen.eligibility.need;
  const rate = completionRate(profile, model.digest);
  const size =
    need === null
      ? ""
      : `, needs ${(need.totalBytes / gib).toFixed(1)} GiB at a ${contextTokens}-token context`;
  const speed =
    chosen.probe.tokensPerSecond === null
      ? ""
      : `, ${chosen.probe.tokensPerSecond} tok/s in its probe`;
  const outcome = profile.outcomes[model.digest];
  const finished = outcome === undefined ? 0 : outcome.complete + outcome.other;
  const history =
    finished === 0
      ? "no finished tasks recorded for it here yet"
      : `${finished} finished task${finished === 1 ? "" : "s"} recorded for it here (${outcome?.complete ?? 0} complete), too few to rank by`;
  // Models at least as large, ranked below the chosen one for their record alone.
  const passed = ranked.filter(
    (one) =>
      (one.eligibility.model.parameters ?? 0) >= (model.parameters ?? 0) &&
      expectedRate(profile, one.eligibility.model.digest) < expectedRate(profile, model.digest),
  );
  const records = passed.map((one) => {
    const record = profile.outcomes[one.eligibility.model.digest];
    const total = (record?.complete ?? 0) + (record?.other ?? 0);
    return `${one.eligibility.model.name} (${record?.complete ?? 0} of ${total} finished tasks complete)`;
  });
  const lead =
    records.length === 0
      ? "conservative default: the largest installed model that fits and passed its readiness probe"
      : `ranked above ${records.join(" and ")}, whose record${records.length === 1 ? " is" : "s are"} worse`;
  const reason =
    rate === null
      ? `${lead}${size}${speed}; ${history}`
      : `the best record here: ${Math.round(rate * 100)}% of its finished tasks complete${size}${speed}`;
  return { chosen, reason, alternatives: ranked.slice(1) };
}

/** A model's finished tasks of one kind here, complete and not. */
export function kindRecord(profile: Profile, digest: string, kind: string) {
  const tally = profile.outcomes[digest]?.kinds?.[kind] ?? { complete: 0, other: 0 };
  return { ...tally, finished: tally.complete + tally.other };
}

/** Finished tasks of a kind a model needs here before its record can justify a switch to it. */
const escalationEvidence = 2;

/**
 * Whom to hand a stalled run to, by the record of this kind of task on this machine: the
 * alternative whose share of such tasks completed is the highest, and higher than the current
 * model's, with at least two such tasks finished. A peer (as good, or no record) is never chosen:
 * a stalled task handed between two models with the same record has not completed anything.
 */
export function escalationFor(
  current: string,
  alternatives: readonly { readonly name: string; readonly digest: string }[],
  profile: Profile,
  kind: string,
): {
  readonly to: { readonly name: string; readonly digest: string } | null;
  readonly reason: string;
} {
  const rate = (digest: string) => {
    const record = kindRecord(profile, digest, kind);
    return record.finished === 0 ? null : record.complete / record.finished;
  };
  const mine = kindRecord(profile, current, kind);
  const mineRate = rate(current);
  const said = (record: { complete: number; finished: number }) =>
    `${record.complete} of ${record.finished} ${kind} task(s) complete`;
  const better = alternatives
    .map((one) => ({ one, record: kindRecord(profile, one.digest, kind), rate: rate(one.digest) }))
    .filter(
      (one) =>
        one.record.finished >= escalationEvidence &&
        one.rate !== null &&
        mineRate !== null &&
        one.rate > mineRate,
    )
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  const [best] = better;
  if (best === undefined) {
    return {
      to: null,
      reason:
        mineRate === null
          ? `no record of ${kind} tasks here for the current model, so no measured gap to escalate across`
          : `no other model here has a better record on ${kind} tasks than the current one (${said(mine)})`,
    };
  }
  return {
    to: best.one,
    reason: `${best.one.name} has the better record on ${kind} tasks here (${said(best.record)}, against ${said(mine)})`,
  };
}

/**
 * Whether probing, strongest first, can stop: a model is ready, and every model not yet probed
 * is smaller with no better expected record than the best ready one, so none could be chosen
 * over it. Only the next one was checked before, and a better model further down was never seen.
 */
export function probedEnough(
  found: readonly Candidate[],
  rest: readonly InstalledModel[],
  profile: Profile,
): boolean {
  const ready = found.filter((one) => one.probe.ready);
  if (ready.length === 0) return false;
  const largest = Math.max(...ready.map((one) => one.eligibility.model.parameters ?? 0));
  const best = Math.max(...ready.map((one) => expectedRate(profile, one.eligibility.model.digest)));
  return rest.every(
    (next) => (next.parameters ?? 0) < largest && expectedRate(profile, next.digest) <= best,
  );
}
