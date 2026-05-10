import * as fs from 'fs';
import * as path from 'path';
import {
  CONTRACT_SCHEMA_VERSION,
  type ContractManifest,
  type FinalContract,
  type ObligationV1,
} from './types';
import { canonicalSerialize } from './canonicalize';
import { validateObligations } from './validator';

/** Filenames for the on-disk artifacts of a finalized contract. */
export const CONTRACT_FILENAME = 'contract.jsonl';
export const MANIFEST_FILENAME = 'manifest.json';

/**
 * Write a finalized contract to `<dir>/contract.jsonl` and
 * `<dir>/manifest.json`. The directory is created if absent. Existing files
 * are overwritten (idempotent for the same input).
 */
export function writeContract(dir: string, contract: FinalContract): void {
  fs.mkdirSync(dir, { recursive: true });
  const jsonl = canonicalSerialize(contract.obligations);
  fs.writeFileSync(path.join(dir, CONTRACT_FILENAME), jsonl, 'utf8');
  const manifestJson = JSON.stringify(contract.manifest, null, 2) + '\n';
  fs.writeFileSync(path.join(dir, MANIFEST_FILENAME), manifestJson, 'utf8');
}

/**
 * Read a finalized contract from `<dir>/contract.jsonl` and
 * `<dir>/manifest.json`. Validates obligations against the v1 schema before
 * returning; throws on schema mismatch or missing files.
 */
export function readContract(dir: string): FinalContract {
  const manifestPath = path.join(dir, MANIFEST_FILENAME);
  const obligationsPath = path.join(dir, CONTRACT_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`contract manifest not found at ${manifestPath}`);
  }
  if (!fs.existsSync(obligationsPath)) {
    throw new Error(`contract obligations not found at ${obligationsPath}`);
  }
  const manifest = readManifest(manifestPath);
  const obligations = parseJsonl(fs.readFileSync(obligationsPath, 'utf8'));
  // Mirror compileGoal/finalize: build is only required when the captured
  // repoContext indicates the project actually has a build step.
  const requireBuild = manifest.repoContext.buildCommand !== null;
  const validation = validateObligations(obligations, { requireBuild });
  if (!validation.valid) {
    throw new Error(
      `contract obligations at ${obligationsPath} failed validation: ` +
        validation.errors.map((e) => e.message).join('; '),
    );
  }
  return { manifest, obligations: obligations as ObligationV1[] };
}

function readManifest(file: string): ContractManifest {
  const raw = fs.readFileSync(file, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`contract manifest ${file} is not valid JSON: ${(err as Error).message}`, {
      cause: err,
    });
  }
  if (!isManifestShape(parsed)) {
    throw new Error(`contract manifest ${file} is missing required fields`);
  }
  if (parsed.schemaVersion !== CONTRACT_SCHEMA_VERSION) {
    throw new Error(
      `contract manifest ${file} declares schemaVersion "${parsed.schemaVersion}"; this build only supports "${CONTRACT_SCHEMA_VERSION}"`,
    );
  }
  return parsed;
}

function isManifestShape(x: unknown): x is ContractManifest {
  if (typeof x !== 'object' || x === null) return false;
  const m = x as Record<string, unknown>;
  return (
    typeof m.schemaVersion === 'string' &&
    typeof m.contractHash === 'string' &&
    typeof m.contractId === 'string' &&
    typeof m.goal === 'string' &&
    typeof m.createdAt === 'string' &&
    typeof m.repoContext === 'object' &&
    m.repoContext !== null &&
    typeof m.extractor === 'object' &&
    m.extractor !== null
  );
}

/**
 * Parse a JSONL string into an array of obligation candidates. Blank lines
 * are tolerated (skipped); any non-blank line that isn't valid JSON throws.
 * Returns `unknown[]` so the caller can run schema validation.
 */
export function parseJsonl(text: string): unknown[] {
  const out: unknown[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim().length === 0) continue;
    try {
      out.push(JSON.parse(line));
    } catch (err) {
      throw new Error(
        `line ${i + 1} of contract.jsonl is not valid JSON: ${(err as Error).message}`,
        { cause: err },
      );
    }
  }
  return out;
}
