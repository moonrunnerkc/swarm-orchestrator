import type { LocalRuntimeName } from "../providers/local-discovery.ts";
import type { GpuReading, HardwareProfile } from "./hardware-probe.ts";
import type { Shortlist, ShortlistBackend, ShortlistModel, ShortlistTier } from "./shortlist.ts";

/**
 * rapid-mlx serves MLX weights, which run on Apple Silicon and nowhere else. Ollama runs
 * everywhere, so it is the only backend a non-Apple machine can be sent to.
 */
const appleSiliconOnlyBackends: ReadonlySet<LocalRuntimeName> = new Set(["rapid-mlx"]);

/** macOS caps what the GPU may hold at roughly three quarters of unified memory. */
const unifiedMemoryShare = 0.75;

/** Off the GPU the model shares memory with the OS and whatever else is open. */
const systemMemoryShare = 0.6;

interface RecommendedModel {
  readonly outcome: "model";
  readonly tier: ShortlistTier;
  readonly model: ShortlistModel;
  readonly backend: ShortlistBackend;
  /** What to pass to `swarm --model`. */
  readonly modelSpec: string;
  readonly reasoning: readonly string[];
  readonly caveats: readonly string[];
}

interface NoTierMatched {
  readonly outcome: "no-tier";
  readonly reasoning: readonly string[];
  readonly caveats: readonly string[];
}

export type Recommendation = RecommendedModel | NoTierMatched;

/**
 * Static fit: hardware in, one model out, with the arithmetic shown. Every sentence it produces
 * names a number the probe measured, so a reader can disagree with the conclusion by checking
 * the inputs rather than by trusting the recommender.
 */
export function recommendModel(profile: HardwareProfile, shortlist: Shortlist): Recommendation {
  const vram = measuredVram(profile);
  const allowance = memoryAllowance(profile, vram);
  const matches = shortlist.tiers.filter((tier) => tierMatches(tier, profile, vram));
  const tier = highestRanked(matches);

  if (tier === null) {
    return {
      outcome: "no-tier",
      reasoning: describeNoTier(shortlist, profile, vram),
      caveats: [...profile.notes],
    };
  }

  const backend = chooseBackend(tier, profile, shortlist);
  const pool = poolFor(tier, profile, backend);
  const fitting = pool.filter((candidate) => candidate.residentGb <= allowance.gb);
  const model = fitting[0] ?? smallest(pool);
  if (model === undefined) {
    throw new Error(`tier "${tier.id}" matched with no model this machine can serve`);
  }

  return {
    outcome: "model",
    tier,
    model,
    backend,
    modelSpec: `local:${model.id}`,
    reasoning: [
      ...describeTierMatch(tier, profile, vram),
      ...describeNextTierUp(shortlist, tier, profile, vram),
      describeBackendChoice(tier, profile, backend, shortlist),
      describeModelChoice(tier, model, allowance, fitting.length > 0),
    ],
    caveats: [...profile.notes, ...describeCaveats(tier, model, allowance, profile, fitting)],
  };
}

/**
 * The models calibration should measure: everything in the matched tier this machine can
 * actually serve, with the static pick first so the report's comparison has both sides. Capped
 * because the micro-eval has minutes, and every extra model multiplies the runs.
 */
export function calibrationCandidates(
  recommendation: RecommendedModel,
  profile: HardwareProfile,
  limit: number,
): readonly string[] {
  const servable = servableModels(recommendation.tier, profile);
  const ordered = [
    recommendation.model,
    ...servable.filter((model) => model.id !== recommendation.model.id),
  ];
  return ordered.slice(0, Math.max(1, limit)).map((model) => `local:${model.id}`);
}

/** The largest VRAM any GPU reported, and which one reported it. */
function measuredVram(profile: HardwareProfile): GpuReading | null {
  let best: GpuReading | null = null;
  for (const gpu of profile.gpus) {
    if (gpu.vramGb !== null && (best === null || gpu.vramGb > (best.vramGb ?? 0))) {
      best = gpu;
    }
  }
  return best;
}

type AllowanceBasis = "vram" | "unified" | "system-memory";

interface MemoryAllowance {
  readonly gb: number;
  readonly basis: AllowanceBasis;
  /** Reads as a noun phrase inside "against ___, leaving 3.0 GB". */
  readonly phrase: string;
}

function memoryAllowance(profile: HardwareProfile, vram: GpuReading | null): MemoryAllowance {
  if (profile.appleSilicon) {
    const gb = round(profile.totalRamGb * unifiedMemoryShare);
    return {
      gb,
      basis: "unified",
      phrase:
        `${formatGb(gb)} usable, ${percent(unifiedMemoryShare)} of the ` +
        `${formatGb(profile.totalRamGb)} of unified memory the probe measured`,
    };
  }
  if (vram?.vramGb != null) {
    return {
      gb: vram.vramGb,
      basis: "vram",
      phrase: `the ${formatGb(vram.vramGb)} of VRAM the probe measured on ${vram.name}`,
    };
  }
  const gb = round(profile.totalRamGb * systemMemoryShare);
  return {
    gb,
    basis: "system-memory",
    phrase:
      `${formatGb(gb)} usable, ${percent(systemMemoryShare)} of the ` +
      `${formatGb(profile.totalRamGb)} of system memory the probe measured`,
  };
}

function tierMatches(
  tier: ShortlistTier,
  profile: HardwareProfile,
  vram: GpuReading | null,
): boolean {
  return (
    suitsPlatform(tier, profile) &&
    servableModels(tier, profile).length > 0 &&
    profile.totalRamGb >= tier.minRamGb &&
    (tier.minVramGb === null || (vram?.vramGb ?? 0) >= tier.minVramGb)
  );
}

function suitsPlatform(tier: ShortlistTier, profile: HardwareProfile): boolean {
  return tier.appleSilicon === null || tier.appleSilicon === profile.appleSilicon;
}

/** A model whose backend cannot run here is not an option, however well it would fit. */
function servableModels(tier: ShortlistTier, profile: HardwareProfile): readonly ShortlistModel[] {
  if (profile.appleSilicon) {
    return tier.models;
  }
  return tier.models.filter((model) => !appleSiliconOnlyBackends.has(model.backend));
}

function highestRanked(tiers: readonly ShortlistTier[]): ShortlistTier | null {
  return tiers.reduce<ShortlistTier | null>(
    (best, tier) => (best === null || tier.rank > best.rank ? tier : best),
    null,
  );
}

function chooseBackend(
  tier: ShortlistTier,
  profile: HardwareProfile,
  shortlist: Shortlist,
): ShortlistBackend {
  const preferred = preferredBackend(profile, shortlist);
  const served = new Set(servableModels(tier, profile).map((model) => model.backend));
  const chosen = served.has(preferred.name)
    ? preferred
    : shortlist.backends.find((backend) => served.has(backend.name));
  if (chosen === undefined) {
    throw new Error(`tier "${tier.id}" matched with no backend this machine can run`);
  }
  return chosen;
}

/** Backends are declared in preference order among those a machine can run. */
function preferredBackend(profile: HardwareProfile, shortlist: Shortlist): ShortlistBackend {
  const runnable = shortlist.backends.filter(
    (backend) => profile.appleSilicon || !appleSiliconOnlyBackends.has(backend.name),
  );
  const specialised = profile.appleSilicon
    ? runnable.find((backend) => appleSiliconOnlyBackends.has(backend.name))
    : undefined;
  const chosen = specialised ?? runnable[0];
  if (chosen === undefined) {
    throw new Error("the shortlist declares no backend this machine can run");
  }
  return chosen;
}

/**
 * Declared order is the curator's ranking and it is kept: which of two models that both fit is
 * the better coding agent turns on tool-call reliability, context window, and dense-versus-MoE
 * speed, none of which a resident-size comparison can see.
 */
function poolFor(
  tier: ShortlistTier,
  profile: HardwareProfile,
  backend: ShortlistBackend,
): readonly ShortlistModel[] {
  const servable = servableModels(tier, profile);
  const preferred = servable.filter((model) => model.backend === backend.name);
  return preferred.length > 0 ? preferred : servable;
}

/** The least bad option when the machine cannot hold anything the tier lists. */
function smallest(pool: readonly ShortlistModel[]): ShortlistModel | undefined {
  return pool.reduce<ShortlistModel | undefined>(
    (best, model) => (best === undefined || model.residentGb < best.residentGb ? model : best),
    undefined,
  );
}

function describeTierMatch(
  tier: ShortlistTier,
  profile: HardwareProfile,
  vram: GpuReading | null,
): readonly string[] {
  const lines = [
    `tier "${tier.id}" (${tier.label}) is the highest-ranked tier this machine satisfies.`,
  ];

  if (tier.appleSilicon === true) {
    lines.push(
      `it is for Apple Silicon machines: the probe found ${profile.platform}/${profile.arch}` +
        `${chipSuffix(profile)}.`,
    );
  }
  if (tier.appleSilicon === false) {
    lines.push(
      "it is for machines that are not Apple Silicon: the probe found " +
        `${profile.platform}/${profile.arch}.`,
    );
  }
  if (tier.minRamGb > 0) {
    lines.push(
      `it asks for ${formatGb(tier.minRamGb)} of system memory: the probe measured ` +
        `${formatGb(profile.totalRamGb)}.`,
    );
  }
  if (tier.minVramGb !== null && vram?.vramGb != null) {
    lines.push(
      `it asks for ${formatGb(tier.minVramGb)} of VRAM: the probe measured ` +
        `${formatGb(vram.vramGb)} on ${vram.name}.`,
    );
  }
  return lines;
}

/**
 * The interesting half of "which tier matched" is which one did not, so the reader can see
 * the single number standing between this machine and a better model.
 */
function describeNextTierUp(
  shortlist: Shortlist,
  matched: ShortlistTier,
  profile: HardwareProfile,
  vram: GpuReading | null,
): readonly string[] {
  const above = shortlist.tiers
    .filter((tier) => tier.rank > matched.rank && suitsPlatform(tier, profile))
    .sort((left, right) => left.rank - right.rank);
  const next = above[0];
  if (next === undefined) {
    return [];
  }
  return [
    `the next tier up, "${next.id}" (${next.label}), was ruled out: ` +
      `it ${describeShortfall(next, profile, vram)}.`,
  ];
}

function describeShortfall(
  tier: ShortlistTier,
  profile: HardwareProfile,
  vram: GpuReading | null,
): string {
  if (tier.minVramGb !== null && (vram?.vramGb ?? 0) < tier.minVramGb) {
    const measured =
      vram?.vramGb == null ? "could not read any" : `measured ${formatGb(vram.vramGb)}`;
    return `asks for ${formatGb(tier.minVramGb)} of VRAM and the probe ${measured}`;
  }
  if (profile.totalRamGb < tier.minRamGb) {
    return (
      `asks for ${formatGb(tier.minRamGb)} of system memory and the probe measured ` +
      formatGb(profile.totalRamGb)
    );
  }
  return "lists no model this machine can serve";
}

function describeBackendChoice(
  tier: ShortlistTier,
  profile: HardwareProfile,
  chosen: ShortlistBackend,
  shortlist: Shortlist,
): string {
  const preferred = preferredBackend(profile, shortlist);
  if (chosen.name !== preferred.name) {
    return (
      `the backend is ${chosen.label}: ${preferred.name} is preferred on Apple Silicon, ` +
      `but tier "${tier.id}" lists no ${preferred.name} model.`
    );
  }
  if (profile.appleSilicon && appleSiliconOnlyBackends.has(chosen.name)) {
    return `the backend is ${chosen.label}: the probe found Apple Silicon, which is what it serves.`;
  }
  const appleOnly = shortlist.backends.filter((backend) =>
    appleSiliconOnlyBackends.has(backend.name),
  );
  if (!profile.appleSilicon && appleOnly.length > 0) {
    return (
      `the backend is ${chosen.label}: ` +
      `${appleOnly.map((backend) => backend.name).join(" and ")} serves Apple Silicon only.`
    );
  }
  return `the backend is ${chosen.label}.`;
}

function describeModelChoice(
  tier: ShortlistTier,
  model: ShortlistModel,
  allowance: MemoryAllowance,
  fits: boolean,
): string {
  if (!fits) {
    return (
      `${model.id} is the smallest model in tier "${tier.id}": it needs about ` +
      `${formatGb(model.residentGb)} resident, against ${allowance.phrase}.`
    );
  }
  return (
    `the shortlist ranks ${model.id} first among the models in tier "${tier.id}" that fit: ` +
    `it needs about ${formatGb(model.residentGb)} resident, against ${allowance.phrase}, ` +
    `leaving ${formatGb(round(allowance.gb - model.residentGb))}.`
  );
}

function describeCaveats(
  tier: ShortlistTier,
  model: ShortlistModel,
  allowance: MemoryAllowance,
  profile: HardwareProfile,
  fitting: readonly ShortlistModel[],
): readonly string[] {
  const caveats: string[] = [];

  if (fitting.length === 0) {
    caveats.push(
      `nothing in tier "${tier.id}" fits the ${formatGb(allowance.gb)} measured: the smallest, ` +
        `${model.id}, needs about ${formatGb(model.residentGb)} resident. It will load only if ` +
        "the machine can swap, and it will be slow.",
    );
  }

  if (allowance.basis === "system-memory") {
    caveats.push(
      "the fit was measured against system memory because no GPU memory could be read. The " +
        `${percent(systemMemoryShare)} allowance leaves room for the OS and your editor: it is ` +
        "a rule of thumb, not a measurement of this machine.",
    );
  }

  const unread = profile.gpus.filter((gpu) => gpu.vramGb === null);
  if (unread.length > 0) {
    caveats.push(
      `${unread.map((gpu) => gpu.name).join(", ")} is present but did not report its VRAM, so ` +
        "no tier that asks for VRAM could be considered. Once you know the card's memory, a " +
        "larger model from a higher tier may be the better pick.",
    );
  }

  return caveats;
}

function describeNoTier(
  shortlist: Shortlist,
  profile: HardwareProfile,
  vram: GpuReading | null,
): readonly string[] {
  const smallest = [...shortlist.tiers].sort((left, right) => left.rank - right.rank)[0];
  const lines = ["no tier in the shortlist matches this machine."];
  if (smallest !== undefined) {
    lines.push(
      `the smallest tier, "${smallest.id}" (${smallest.label}), ` +
        `${describeShortfall(smallest, profile, vram)}.`,
    );
  }
  return lines;
}

function chipSuffix(profile: HardwareProfile): string {
  const chip = profile.gpus.find((gpu) => gpu.unifiedMemory);
  return chip === undefined ? "" : ` (${chip.name})`;
}

function formatGb(value: number): string {
  return `${value.toFixed(1)} GB`;
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
