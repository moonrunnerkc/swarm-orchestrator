// Phase 1 provision proof. Drives the real sandbox provisioner
// (provisionWorkspace) against the wild entries whose viability changed, so the
// lift report can cite actual clone+install command output rather than a claim.
// This exercises the fixed execEnv -> corepack-shim PATH path end to end.
//
// Infrastructure only: it clones and installs (whether code runs), never reads a
// diff or a detection verdict. Permitted against wild checkouts per the run's
// held-out refinement.
//
// Usage (SWARM_EG_NODE_BIN must point at a Node 22 bin dir):
//   SWARM_EG_NODE_BIN=/path/to/node@22/bin \
//     node dist/scripts/real-prs/hunt3-provision-proof.js <id-or-repo> [...]
//   (no args: runs the default changed-entry set)

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import { provisionWorkspace } from '../../src/audit/execution-grounded/sandbox';

const log = getLogger('real-prs:provision-proof');

interface WildEntry {
  id: string;
  repo: string;
  prNumber: number;
  headSha: string;
}

const DATASET_FILE = path.join('benchmarks', 'real-prs', 'wild-cheat-corpus', 'v1', 'dataset.json');
const OUT_FILE = path.join('benchmarks', 'real-prs', 'hunt3', 'provision-proof.json');

// The entries whose provisioning this run touched: two known install failures and
// the node-engine false-negative flipped viable. Overridable via argv.
const DEFAULT_TARGETS = [
  'yorickdewid/flight-planner',
  'outline/outline',
  'inmanta/web-console',
];

interface ProvisionProof {
  id: string;
  repo: string;
  prNumber: number;
  headSha: string;
  provisioned: boolean;
  packageManager: string | null;
  testRunner: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorCause: string | null;
}

function loadEntries(): WildEntry[] {
  const raw = JSON.parse(fs.readFileSync(DATASET_FILE, 'utf8')) as { entries: WildEntry[] };
  return raw.entries;
}

function errFields(err: unknown): { code: string | null; message: string; cause: string | null } {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : null;
  const causeErr = err instanceof Error ? (err.cause as unknown) : null;
  const cause = causeErr instanceof Error ? causeErr.message : causeErr != null ? String(causeErr) : null;
  return { code, message, cause };
}

async function proveOne(entry: WildEntry, baseDir: string): Promise<ProvisionProof> {
  const cacheDir = path.join(baseDir, '.pm-cache');
  log.info(`provisioning ${entry.repo}@${entry.headSha.slice(0, 10)} ...`);
  try {
    const ws = provisionWorkspace({
      repo: entry.repo,
      commit: entry.headSha,
      baseDir,
      cacheDir,
      installTimeoutMs: 15 * 60 * 1000,
    });
    const proof: ProvisionProof = {
      id: entry.id,
      repo: entry.repo,
      prNumber: entry.prNumber,
      headSha: entry.headSha,
      provisioned: true,
      packageManager: ws.packageManager,
      testRunner: ws.testRunner,
      errorCode: null,
      errorMessage: null,
      errorCause: null,
    };
    ws.cleanup();
    log.info(`  provisioned: ${entry.repo} (pm=${ws.packageManager}, runner=${ws.testRunner ?? 'none'})`);
    return proof;
  } catch (err) {
    const { code, message, cause } = errFields(err);
    log.warn(`  NOT provisioned: ${entry.repo}: ${message}`);
    return {
      id: entry.id,
      repo: entry.repo,
      prNumber: entry.prNumber,
      headSha: entry.headSha,
      provisioned: false,
      packageManager: null,
      testRunner: null,
      errorCode: code,
      errorMessage: message,
      errorCause: cause,
    };
  }
}

async function main(): Promise<void> {
  if (process.env.SWARM_EG_NODE_BIN === undefined || process.env.SWARM_EG_NODE_BIN.length === 0) {
    throw new Error(
      'SWARM_EG_NODE_BIN is required; point it at a Node 22 bin dir (with corepack) so the ' +
        'provisioner uses the pinned runtime, e.g. SWARM_EG_NODE_BIN=~/.nvm/versions/node/v22.15.0/bin',
    );
  }
  const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_TARGETS;
  const entries = loadEntries();
  const selected = entries.filter((e) => targets.includes(e.id) || targets.includes(e.repo));
  if (selected.length === 0) throw new Error(`no wild entries matched: ${targets.join(', ')}`);

  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-provision-proof-'));
  const proofs: ProvisionProof[] = [];
  try {
    for (const entry of selected) {
      proofs.push(await proveOne(entry, baseDir));
    }
  } finally {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify(
      {
        computedBy: 'scripts/real-prs/hunt3-provision-proof.ts',
        nodeBin: process.env.SWARM_EG_NODE_BIN,
        proofs,
      },
      null,
      2,
    ) + '\n',
  );
  const ok = proofs.filter((p) => p.provisioned).length;
  log.info(`provision proof: ${ok}/${proofs.length} provisioned; wrote ${OUT_FILE}`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
}
