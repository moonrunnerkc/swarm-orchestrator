// Fold maintainer-approved complaint-mined entries into the wild-cheat corpus.
// The only path by which a mined candidate enters the held-out corpus, and it is
// explicit: the maintainer reviews incoming/REVIEW.md, then names the ids to
// fold. This never runs automatically and never folds without an approved-ids
// list. It writes a NEW corpus version (a bump), leaving the prior version
// untouched, and recomputes the counts.
//
// Usage:
//   node dist/scripts/real-prs/fold-approved.js --approved-ids id-1,id-2
//   node dist/scripts/real-prs/fold-approved.js --approved-ids '' # no-op

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import {
  buildFoldedDataset,
  intakeToWildCheatEntry,
  nextVersion,
  type IntakeRecord,
} from './lib/intake';
import { WILD_CHEAT_CORPUS_DIR, type WildCheatDataset } from './lib/wild-cheat-corpus';

const log = getLogger('real-prs:fold-approved');

const INTAKE_JSON = path.join(WILD_CHEAT_CORPUS_DIR, 'incoming', 'intake.json');

interface IntakeFile {
  readonly records: readonly IntakeRecord[];
}

function parseApprovedIds(argv: string[]): string[] {
  const i = argv.indexOf('--approved-ids');
  if (i < 0) {
    throw new Error(
      'missing --approved-ids; pass a comma-separated id list (or --approved-ids "" for a no-op). ' +
        'Approve ids only after reviewing incoming/REVIEW.md.',
    );
  }
  const raw = argv[i + 1] ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function existingVersions(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^v\d+$/.test(e.name))
    .map((e) => e.name);
}

function readDataset(dir: string, version: string): WildCheatDataset {
  const file = path.join(dir, version, 'dataset.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as WildCheatDataset;
}

function renderDatasetDoc(dataset: WildCheatDataset, priorVersion: string): string {
  return [
    `# Wild cheat corpus ${dataset.version}`,
    '',
    dataset.note,
    '',
    `Built by folding maintainer-approved complaint-mined entries onto \`${priorVersion}\`.`,
    'Every non-mined entry is carried forward unchanged; provenance for the mined',
    'additions is `benchmarks/real-prs/wild-cheat-corpus/incoming/intake.json`.',
    '',
    '## Counts',
    '',
    `- entries: ${dataset.counts.entries}`,
    `- merged: ${dataset.counts.merged}`,
    `- closed: ${dataset.counts.closed}`,
    `- egViable: ${dataset.counts.egViable}`,
    `- folded this version: ${dataset.counts.foldedThisVersion ?? 0}`,
    '',
    '## Held-out status',
    '',
    'This corpus is held out. No detector, prompt, or calibration reads the folded',
    'entries before the next hunt pre-registration freezes them by SHA.',
    '',
  ].join('\n');
}

function main(): void {
  const approvedIds = parseApprovedIds(process.argv.slice(2));
  if (approvedIds.length === 0) {
    log.info('no approved ids; folding nothing and leaving the corpus version unchanged.');
    return;
  }
  if (!fs.existsSync(INTAKE_JSON)) {
    throw new Error(`intake package not found at ${INTAKE_JSON}; run intake-package first`);
  }
  const intake = JSON.parse(fs.readFileSync(INTAKE_JSON, 'utf8')) as IntakeFile;
  const byId = new Map(intake.records.map((r) => [r.id, r]));
  const unknown = approvedIds.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `approved ids not present in the intake package: ${unknown.join(', ')}. ` +
        'Only ids from incoming/REVIEW.md can be folded.',
    );
  }

  const versions = existingVersions(WILD_CHEAT_CORPUS_DIR);
  if (versions.length === 0) {
    throw new Error(`no existing corpus version under ${WILD_CHEAT_CORPUS_DIR}; nothing to fold onto`);
  }
  const priorVersion = versions.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).at(-1) as string;
  const prior = readDataset(WILD_CHEAT_CORPUS_DIR, priorVersion);
  const newVersion = nextVersion(versions);

  const approvedEntries = approvedIds.map((id) => intakeToWildCheatEntry(byId.get(id) as IntakeRecord));
  const folded = buildFoldedDataset(prior.entries, approvedEntries, newVersion);

  const outDir = path.join(WILD_CHEAT_CORPUS_DIR, newVersion);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'dataset.json'), JSON.stringify(folded, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'DATASET.md'), renderDatasetDoc(folded, priorVersion));
  log.info(
    `fold-approved: folded ${folded.counts.foldedThisVersion} entry(ies) onto ${priorVersion} -> ` +
      `${newVersion} (${folded.counts.entries} total). Wrote ${outDir}/dataset.json and DATASET.md.`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err: unknown) {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  }
}
