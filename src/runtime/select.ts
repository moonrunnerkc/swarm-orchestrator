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
  /** A stronger ready model to escalate to once, or null where the chosen is the strongest. */
  readonly escalation: Candidate | null;
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
  const stronger = ranked.find(
    (one) => (one.eligibility.model.parameters ?? 0) > (model.parameters ?? 0),
  );
  return { chosen, reason, escalation: stronger ?? null };
}

/**
 * Whether probing, strongest first, can stop: a model is ready, and the next is smaller with no
 * better expected record than the best ready one, so it could not be chosen over it.
 */
export function probedEnough(
  found: readonly Candidate[],
  next: InstalledModel | null,
  profile: Profile,
): boolean {
  const ready = found.filter((one) => one.probe.ready);
  if (ready.length === 0) return false;
  if (next === null) return true;
  const largest = Math.max(...ready.map((one) => one.eligibility.model.parameters ?? 0));
  const best = Math.max(...ready.map((one) => expectedRate(profile, one.eligibility.model.digest)));
  return (next.parameters ?? 0) < largest && expectedRate(profile, next.digest) <= best;
}
