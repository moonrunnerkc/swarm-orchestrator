import * as path from 'path';
import { buildLabelStatus, summarizeLabelStatus } from '../label-store';
import { loadCorpus } from '../loader';

interface LabelStatusArgs {
  corpusDir: string;
  labelsDir: string;
}

/** Prints which corpus entries have usable labels and which still need review. */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const entries = await loadCorpus(args.corpusDir);
  const rows = await buildLabelStatus(entries, args.labelsDir);
  const summary = summarizeLabelStatus(rows);

  console.log(`Corpus: ${path.resolve(args.corpusDir)}`);
  console.log(`Labels: ${path.resolve(args.labelsDir)}`);
  console.log(`Entries: ${entries.length}`);
  console.log(`Labeled: ${summary.labeled ?? 0}`);
  console.log(`Unlabeled: ${summary.unlabeled ?? 0}`);
  console.log(`Invalid: ${summary.invalid ?? 0}`);
  console.log(`Verdicts: clean=${summary['verdict:clean'] ?? 0}, broken=${summary['verdict:broken'] ?? 0}, ambiguous=${summary['verdict:ambiguous'] ?? 0}`);
  console.log('');

  for (const row of rows) {
    const verdict = row.verdict === undefined ? '' : ` ${row.verdict}`;
    const issues = row.issues.length === 0 ? '' : ` ${row.issues.join('; ')}`;
    console.log(`${row.status.toUpperCase()}${verdict} ${row.entryId} ${row.labelPath}${issues}`);
  }
}

function parseArgs(argv: string[]): LabelStatusArgs {
  let corpusDir = path.resolve('verification-runs');
  let labelsDir = path.resolve('benchmarks/falsification-corpus/labels');
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--corpus') {
      corpusDir = path.resolve(requireValue(argv, i += 1, '--corpus'));
    } else if (arg === '--labels') {
      labelsDir = path.resolve(requireValue(argv, i += 1, '--labels'));
    } else {
      throw new Error(`label-status [args]: unknown option ${arg ?? ''}`);
    }
  }
  return { corpusDir, labelsDir };
}

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`label-status [args]: ${option} requires a value`);
  }
  return value;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
