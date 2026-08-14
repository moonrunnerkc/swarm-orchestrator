export type GpuVendor = "apple" | "nvidia" | "amd" | "intel" | "unknown";

export interface GpuReading {
  readonly vendor: GpuVendor;
  readonly name: string;
  /** Null when nothing on this platform reports it; the fit is then measured against RAM. */
  readonly vramGb: number | null;
  /** True when the GPU addresses system memory, so vramGb is not a second pool. */
  readonly unifiedMemory: boolean;
}

export interface HardwareProfile {
  readonly platform: string;
  readonly arch: string;
  readonly appleSilicon: boolean;
  readonly totalRamGb: number;
  readonly gpus: readonly GpuReading[];
  /** What the probe could not determine, in the words of the probe that failed. */
  readonly notes: readonly string[];
}

/** Returns the command's stdout, or null when it is missing, fails, or times out. */
export type ProbeCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<string | null>;

export interface ProbeEnvironment {
  readonly platform: string;
  readonly arch: string;
  readonly totalMemoryBytes: number;
  readonly runCommand: ProbeCommandRunner;
}

const gibibyte = 1024 ** 3;

/**
 * Measures the machine, and is explicit about what it could not measure. An absent probe is
 * an ordinary absence rather than an error: the recommendation degrades to system memory and
 * says so, which is more useful than refusing to answer.
 */
export async function probeHardware(environment: ProbeEnvironment): Promise<HardwareProfile> {
  const totalRamGb = roundGb(environment.totalMemoryBytes / gibibyte);
  const appleSilicon = environment.platform === "darwin" && environment.arch === "arm64";
  const gpus = appleSilicon
    ? [await probeAppleSilicon(environment, totalRamGb)]
    : await probeDiscreteGpus(environment);

  return {
    platform: environment.platform,
    arch: environment.arch,
    appleSilicon,
    totalRamGb,
    gpus,
    notes: describeGaps(gpus, environment.platform, appleSilicon),
  };
}

/** On Apple Silicon the GPU has no pool of its own: it addresses the system memory. */
async function probeAppleSilicon(
  environment: ProbeEnvironment,
  totalRamGb: number,
): Promise<GpuReading> {
  const brand = await environment.runCommand("sysctl", ["-n", "machdep.cpu.brand_string"]);
  return {
    vendor: "apple",
    name: brand?.trim() || "Apple Silicon",
    vramGb: totalRamGb,
    unifiedMemory: true,
  };
}

/** nvidia-smi first because it is the only one of the two that reports a memory size. */
async function probeDiscreteGpus(environment: ProbeEnvironment): Promise<readonly GpuReading[]> {
  const smi = await environment.runCommand("nvidia-smi", [
    "--query-gpu=name,memory.total",
    "--format=csv,noheader,nounits",
  ]);
  const nvidia = parseNvidiaSmi(smi);
  if (nvidia.length > 0) {
    return nvidia;
  }
  if (environment.platform !== "linux") {
    return [];
  }
  return parseLspci(await environment.runCommand("lspci", []));
}

function parseNvidiaSmi(output: string | null): readonly GpuReading[] {
  const readings: GpuReading[] = [];
  for (const line of splitLines(output)) {
    const [name, mebibytes] = line.split(",").map((field) => field.trim());
    const vram = Number(mebibytes);
    if (name === undefined || name.length === 0 || !Number.isFinite(vram) || vram <= 0) {
      continue;
    }
    readings.push({
      vendor: vendorOf(name),
      name,
      vramGb: roundGb(vram / 1024),
      unifiedMemory: false,
    });
  }
  return readings;
}

/** The device name is whatever follows the display-controller class on an lspci line. */
const displayController = /(?:VGA compatible controller|3D controller|Display controller):\s*(.+)$/;

function parseLspci(output: string | null): readonly GpuReading[] {
  const readings: GpuReading[] = [];
  for (const line of splitLines(output)) {
    const name = displayController.exec(line)?.[1]?.replace(/\s*\(rev [^)]*\)$/, "");
    if (name === undefined || name.length === 0) {
      continue;
    }
    readings.push({ vendor: vendorOf(name), name, vramGb: null, unifiedMemory: false });
  }
  return readings;
}

function vendorOf(name: string): GpuVendor {
  if (/nvidia/i.test(name)) {
    return "nvidia";
  }
  if (/\bamd\b|ati|radeon/i.test(name)) {
    return "amd";
  }
  if (/intel|arc\b/i.test(name)) {
    return "intel";
  }
  return "unknown";
}

function describeGaps(
  gpus: readonly GpuReading[],
  platform: string,
  appleSilicon: boolean,
): readonly string[] {
  if (gpus.length === 0) {
    const tried = appleSilicon || platform !== "linux" ? ["nvidia-smi"] : ["nvidia-smi", "lspci"];
    return [`no GPU was detected: ${tried.join(" and ")} did not answer.`];
  }
  return gpus
    .filter((gpu) => gpu.vramGb === null)
    .map(
      (gpu) => `lspci named the GPU but not its memory size, so VRAM is unknown for ${gpu.name}.`,
    );
}

function splitLines(output: string | null): readonly string[] {
  return (output ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function roundGb(value: number): number {
  return Math.round(value * 10) / 10;
}
