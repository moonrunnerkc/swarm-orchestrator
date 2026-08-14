import { formatBackendCommands } from "./backend-command.ts";
import type { GpuReading, HardwareProfile } from "./hardware-probe.ts";
import type { Recommendation } from "./recommendation.ts";
import type { LoadedShortlist } from "./shortlist-source.ts";

interface SelectReport {
  readonly profile: HardwareProfile;
  readonly loaded: LoadedShortlist;
  readonly recommendation: Recommendation;
}

const labelWidth = 18;

/**
 * The whole of what `swarm select` prints. Every number here came off the probe or out of the
 * shortlist, so a reader who disagrees with the pick can see which input to argue with.
 */
export function renderSelectReport(report: SelectReport): readonly string[] {
  const lines = [
    ...section("hardware", describeHardware(report.profile)),
    "",
    ...section("shortlist", describeShortlist(report.loaded)),
  ];

  if (report.recommendation.outcome === "model") {
    lines.push("", ...section("recommendation", describeRecommendation(report.recommendation)));
  }

  lines.push("", ...section("why", bullets(report.recommendation.reasoning)));

  if (report.recommendation.caveats.length > 0) {
    lines.push("", ...section("caveats", bullets(report.recommendation.caveats)));
  }

  if (report.recommendation.outcome === "model") {
    lines.push("", ...section("run it", describeCommands(report.recommendation)));
  }

  lines.push(
    "",
    "sizes and memory figures above are curated estimates, not measurements of this machine.",
  );
  return lines;
}

function section(title: string, body: readonly string[]): readonly string[] {
  return [title, ...body.map((line) => `  ${line}`)];
}

function field(label: string, value: string): string {
  return `${label.padEnd(labelWidth)}${value}`;
}

function bullets(lines: readonly string[]): readonly string[] {
  return lines.map((line) => `- ${line}`);
}

function describeHardware(profile: HardwareProfile): readonly string[] {
  const platform = `${profile.platform} ${profile.arch}${
    profile.appleSilicon ? " (Apple Silicon)" : ""
  }`;
  const gpus =
    profile.gpus.length === 0
      ? [field("gpu", "none detected")]
      : profile.gpus.map((gpu, index) => field(index === 0 ? "gpu" : "", describeGpu(gpu)));

  return [
    field("platform", platform),
    field("system memory", gigabytes(profile.totalRamGb)),
    ...gpus,
  ];
}

function describeGpu(gpu: GpuReading): string {
  if (gpu.vramGb === null) {
    return `${gpu.name}, VRAM unknown`;
  }
  return `${gpu.name}, ${gigabytes(gpu.vramGb)} ${gpu.unifiedMemory ? "unified memory" : "VRAM"}`;
}

function describeShortlist(loaded: LoadedShortlist): readonly string[] {
  const lines = [field("source", loaded.location), field("revision", loaded.shortlist.revision)];
  if (loaded.fallbackReason !== null) {
    lines.push(field("fell back", loaded.fallbackReason));
  }
  return lines;
}

function describeRecommendation(
  recommendation: Extract<Recommendation, { outcome: "model" }>,
): readonly string[] {
  const { model, tier, backend } = recommendation;
  return [
    field("model", model.id),
    field("backend", backend.label),
    field(
      "weights",
      `${model.parameters} at ${model.quantization}, ${gigabytes(model.diskGb)} to download`,
    ),
    field("context window", `${model.contextWindow} tokens`),
    field("tier", `${tier.id} (${tier.label})`),
  ];
}

function describeCommands(
  recommendation: Extract<Recommendation, { outcome: "model" }>,
): readonly string[] {
  const commands = formatBackendCommands(recommendation.backend, recommendation.model.id);
  return [
    commands.install,
    commands.serve,
    `SWARM_LOCAL_BASE_URL=${recommendation.backend.baseUrl} swarm --model ` +
      `${recommendation.modelSpec} "your task"`,
  ];
}

function gigabytes(value: number): string {
  return `${value.toFixed(1)} GB`;
}
