import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Clock } from "../core/clock.ts";
import {
  type BundleManifest,
  bundleFileNames,
  bundleFormatVersion,
  bundleManifestSchema,
  type WorkerChain,
} from "./bundle-manifest.ts";
import { digestFileName, digestOfBytes, type JsonValue } from "./canonical-json.ts";
import { buildEvidenceDag, type EvidenceDag } from "./dag.ts";
import { type ChainProblem, parseLedgerText, verifyChain } from "./ledger.ts";
import { type LedgerRecord, ledgerSchemaVersion, serializeRecord } from "./ledger-record.ts";
import { renderReviewPage } from "./review-page.ts";
import { findKnownSecrets } from "./scrub.ts";
import type { EvidenceRecorder } from "./session.ts";
import { type SigningKey, signChainHead } from "./signing.ts";

export class BundleChainError extends Error {
  constructor(problems: readonly ChainProblem[]) {
    super(
      `the ledger chain does not verify, so there is nothing honest to export: ` +
        `${problems.map((problem) => problem.detail).join("; ")}. ` +
        "Export the session only from an intact ledger.",
    );
    this.name = "BundleChainError";
  }
}

class BundleIntegrityError extends Error {
  constructor(digest: string) {
    super(
      `blob ${digest} does not hash to its own name, so the session store is corrupt or altered. ` +
        "Nothing is exported.",
    );
    this.name = "BundleIntegrityError";
  }
}

export class BundleScrubGateError extends Error {
  constructor(digest: string, labels: readonly string[]) {
    super(
      `blob ${digest} still matches known credential patterns (${labels.join(", ")}) after write-time scrubbing, ` +
        "so the export stops. Remove the record's source material and rerun the task.",
    );
    this.name = "BundleScrubGateError";
  }
}

export interface BundleSource {
  readonly sessionId: string;
  readonly records: readonly LedgerRecord[];
  readonly blobBytes: (digest: string) => Promise<string | null>;
}

interface ExportBundleOptions {
  readonly source: BundleSource;
  readonly destination: string;
  readonly signingKey: SigningKey;
  readonly clock: Clock;
  /** Worker bundles already written under this destination. Empty for an ordinary run. */
  readonly workers?: readonly WorkerChain[];
}

interface BundleExport {
  readonly directory: string;
  readonly manifest: BundleManifest;
  readonly dag: EvidenceDag;
}

export function bundleSourceFromRecorder(recorder: EvidenceRecorder): BundleSource {
  return {
    sessionId: recorder.sessionId,
    records: recorder.records(),
    blobBytes: (digest) => recorder.blobs.bytes(digest),
  };
}

/**
 * Writes a self-contained bundle: the chain, the blobs it references, the recomputed DAG,
 * a signature over the chain head, a verifier that needs nothing installed, and a static
 * review page. The scrub gate runs a second time here, because once a blob directory is
 * copied, write-time scrubbing alone was too late.
 */
export async function exportBundle(options: ExportBundleOptions): Promise<BundleExport> {
  const { records } = options.source;
  const chain = verifyChain(records);
  if (!chain.ok) {
    throw new BundleChainError(chain.problems);
  }

  const digests = [...new Set(records.map((record) => record.payloadDigest))];
  const payloads = new Map<string, JsonValue>();
  const blobBytes = new Map<string, string>();
  const missingBlobs: string[] = [];

  for (const digest of digests) {
    const bytes = await options.source.blobBytes(digest);
    if (bytes === null) {
      missingBlobs.push(digest);
      continue;
    }
    if (digestOfBytes(bytes) !== digest) {
      throw new BundleIntegrityError(digest);
    }
    const leaked = findKnownSecrets(bytes);
    if (leaked.length > 0) {
      throw new BundleScrubGateError(digest, leaked);
    }
    blobBytes.set(digest, bytes);
    payloads.set(digest, JSON.parse(bytes) as JsonValue);
  }

  const dag = buildEvidenceDag(records, payloads);
  const manifest = bundleManifestSchema.parse({
    bundleFormat: bundleFormatVersion,
    ledgerSchemaVersion,
    sessionId: options.source.sessionId,
    exportedAt: options.clock.now(),
    recordCount: records.length,
    chainHead: chain.head,
    signature: signChainHead(chain.head, options.signingKey),
    blobs: digests,
    missingBlobs,
    claims: { verified: dag.verifiedCount, unverified: dag.unverifiedCount },
    workers: options.workers ?? [],
  });

  const blobDirectory = join(options.destination, bundleFileNames.blobs);
  await mkdir(blobDirectory, { recursive: true });
  for (const [digest, bytes] of blobBytes) {
    await writeFile(join(blobDirectory, digestFileName(digest)), bytes, "utf8");
  }

  await writeFile(
    join(options.destination, bundleFileNames.ledger),
    `${records.map(serializeRecord).join("\n")}\n`,
    "utf8",
  );
  await writeFile(
    join(options.destination, bundleFileNames.manifest),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(options.destination, bundleFileNames.dag),
    `${JSON.stringify(stripPayloads(dag), null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(options.destination, bundleFileNames.verifier),
    await readVerifierScript(),
    "utf8",
  );
  await writeFile(
    join(options.destination, bundleFileNames.review),
    `${renderReviewPage(manifest, dag)}\n`,
    "utf8",
  );

  return { directory: options.destination, manifest, dag };
}

interface BundleContents {
  readonly manifest: BundleManifest;
  readonly records: readonly LedgerRecord[];
  readonly payloads: ReadonlyMap<string, JsonValue>;
  readonly problems: readonly ChainProblem[];
}

/** Reads a bundle back. Read-only on purpose: replay must never write (invariant 2). */
export async function readBundle(directory: string): Promise<BundleContents> {
  const manifest = bundleManifestSchema.parse(
    JSON.parse(await readFile(join(directory, bundleFileNames.manifest), "utf8")),
  );
  const ledger = parseLedgerText(await readFile(join(directory, bundleFileNames.ledger), "utf8"));
  const payloads = new Map<string, JsonValue>();

  for (const digest of new Set(ledger.records.map((record) => record.payloadDigest))) {
    try {
      const bytes = await readFile(
        join(directory, bundleFileNames.blobs, digestFileName(digest)),
        "utf8",
      );
      payloads.set(digest, JSON.parse(bytes) as JsonValue);
    } catch {
      // A blob absent from the bundle leaves its claims unverified, which is a display state.
    }
  }

  return { manifest, records: ledger.records, payloads, problems: ledger.problems };
}

/** The DAG as shipped: no inlined payloads, since the blob directory already holds them. */
function stripPayloads(dag: EvidenceDag): unknown {
  return {
    claims: dag.claims,
    edges: dag.edges,
    evidence: dag.evidence.map(({ payload: _payload, ...node }) => node),
    verifiedCount: dag.verifiedCount,
    unverifiedCount: dag.unverifiedCount,
  };
}

function readVerifierScript(): Promise<string> {
  return readFile(new URL("./verifier/verify.mjs", import.meta.url), "utf8");
}
