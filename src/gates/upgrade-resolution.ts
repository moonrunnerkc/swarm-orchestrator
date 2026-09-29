import { readFile, realpath } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import { asJsonValue, digestOfBytes } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { TaskPreset } from "../evidence/task-preset.ts";
import type { GateCommandRunner } from "./gate-definition.ts";

/** Record the versions actually installed by authorized locked preparation. */
export async function observeUpgradeResolution(options: {
  preset: Extract<TaskPreset, { kind: "upgrade" }>;
  checkout: string;
  commands: GateCommandRunner;
  evidence: EvidenceRecorder;
  timeoutMs: number;
}): Promise<string> {
  const { preset, checkout } = options;
  const cwd = join(checkout, dirname(preset.manifest));
  const versions: Record<string, string> = {};
  if (preset.manager === "uv") {
    const observed = await options.commands.runVouched(
      [
        "uv",
        "run",
        "--locked",
        "--no-sync",
        "python",
        "-c",
        "import importlib.metadata,json,sys;print(json.dumps({name:importlib.metadata.version(name) for name in sys.argv[1:]}))",
        ...preset.dependencies.map((dependency) => dependency.name),
      ],
      { cwd, timeoutMs: options.timeoutMs, maxOutputBytes: 64000 },
    );
    if (observed.exitCode !== 0 || observed.unavailable || observed.outputTruncated)
      throw new Error(
        "installed Python dependency versions are unavailable; inspect the locked environment",
      );
    // The report comes from the project's own environment, so only the declared names are
    // taken from it, as the npm branch below does; an extra key is not a resolved dependency.
    const reported = z.record(z.string(), z.string()).parse(JSON.parse(observed.stdout));
    for (const { name } of preset.dependencies) {
      const version = Object.hasOwn(reported, name) ? reported[name] : undefined;
      if (version !== undefined) versions[name] = version;
    }
  } else {
    for (const dependency of preset.dependencies) {
      const manifest = await realpath(join(cwd, "node_modules", dependency.name, "package.json"));
      if (relative(await realpath(checkout), manifest).startsWith(".."))
        throw new Error("installed dependency resolves outside the owned checkout");
      const installed = z
        .object({ name: z.string(), version: z.string() })
        .parse(JSON.parse(await readFile(manifest, "utf8")));
      if (installed.name !== dependency.name)
        throw new Error("installed dependency identity disagrees with its declared name");
      versions[dependency.name] = installed.version;
    }
  }
  const matched = preset.dependencies.every(
    (dependency) => versions[dependency.name] === dependency.version,
  );
  const record = await options.evidence.record({
    type: "verification-command",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({
      rule: "upgrade-resolution-v1",
      manager: preset.manager,
      versions,
      matched,
      manifestDigest: digestOfBytes(await readFile(join(checkout, preset.manifest))),
      lockDigest: digestOfBytes(await readFile(join(checkout, preset.lockfile))),
    }),
  });
  if (!matched)
    throw new Error("installed dependency versions do not match the sealed upgrade targets");
  return record.record.payloadDigest;
}
