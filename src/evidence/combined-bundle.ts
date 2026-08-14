import { join } from "node:path";
import type { Clock } from "../core/clock.ts";
import { type BundleSource, exportBundle } from "./bundle.ts";
import { bundleFileNames, type WorkerChain } from "./bundle-manifest.ts";
import type { SigningKey } from "./signing.ts";

export interface WorkerBundleSource {
  /** Short name the coordinator knows this worker by, and the directory it lands in. */
  readonly workerId: string;
  readonly source: BundleSource;
}

export interface CombinedBundleOptions {
  /** The chain that ran the queue. Its signature is what covers the run as a whole. */
  readonly coordinator: BundleSource;
  readonly workers: readonly WorkerBundleSource[];
  readonly destination: string;
  readonly signingKey: SigningKey;
  readonly clock: Clock;
}

export interface CombinedBundleExport {
  readonly directory: string;
  readonly workers: readonly WorkerChain[];
}

/**
 * One bundle per parallel run, holding each worker's chain beside the coordinator's.
 *
 * Nested rather than merged: a worker's records stay its own chain, in its own complete
 * bundle, so a reviewer can check one worker in isolation and so no chain has to be
 * rewritten to sit next to another. What ties them together is the coordinator's own
 * records, which name each worker's chain head; the coordinator's signature therefore
 * covers those heads, and the verifier refuses a worker the coordinator never named.
 */
export async function exportCombinedBundle(
  options: CombinedBundleOptions,
): Promise<CombinedBundleExport> {
  const workers: WorkerChain[] = [];

  for (const worker of options.workers) {
    const directory = join(bundleFileNames.workers, worker.workerId);
    const exported = await exportBundle({
      source: worker.source,
      destination: join(options.destination, directory),
      signingKey: options.signingKey,
      clock: options.clock,
    });
    workers.push({
      workerId: worker.workerId,
      sessionId: exported.manifest.sessionId,
      directory,
      chainHead: exported.manifest.chainHead,
      recordCount: exported.manifest.recordCount,
    });
  }

  await exportBundle({
    source: options.coordinator,
    destination: options.destination,
    signingKey: options.signingKey,
    clock: options.clock,
    workers,
  });

  return { directory: options.destination, workers };
}
