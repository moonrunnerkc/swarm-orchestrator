import { lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { type DependencyInstall, installFromLockfile } from "./dependency-install.ts";
import type { GateCommandRunner } from "./gate-definition.ts";

/** Prepare only declared lock roots; a shared workspace lock is synchronized once. */
export async function prepareDependencies(options: {
  checkout: string;
  packages?: readonly string[];
  upgradeManifest?: string;
  commands: GateCommandRunner;
  timeoutMs: number;
  evidence?: EvidenceRecorder;
  signal?: AbortSignal;
}): Promise<DependencyInstall> {
  const candidates =
    options.upgradeManifest === undefined
      ? [".", ...(options.packages ?? [])]
      : [dirname(options.upgradeManifest)];
  const results: DependencyInstall[] = [];
  for (const unit of new Set(candidates)) {
    const workspace = join(options.checkout, unit);
    const locks = await Promise.all(
      ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "uv.lock"].map((file) =>
        lstat(join(workspace, file)).then(
          () => true,
          () => false,
        ),
      ),
    );
    if (!locks.some(Boolean)) continue;
    const result = await installFromLockfile({
      workspace,
      commands: options.commands,
      timeoutMs: options.timeoutMs,
      ...(options.evidence === undefined ? {} : { evidence: options.evidence }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    results.push({ ...result, detail: `${unit}: ${result.detail}` });
    if (!result.succeeded) break;
  }
  return {
    attempted: results.some((entry) => entry.attempted),
    succeeded: results.length > 0 && results.every((entry) => entry.succeeded),
    command: results.map((entry) => entry.command).join("; "),
    detail: results.length
      ? results.map((entry) => entry.detail).join("; ")
      : "no supported lockfile in the selected preparation scope; use an existing environment without --install",
  };
}
