// PR-shaped labeling CLI for the v10.1 real corpus. Mirrors
// `cli/label.ts` but loads `UnlabeledPrCorpusEntry` from
// `benchmarks/real-corpus/raw/` and displays PR title / body / diff
// for human review instead of v8 transcripts.
//
// Reuses `label-rules` (validation, prompt text, broken-category
// vocabulary) and `label-store` (write + path helpers) verbatim. The
// readline prompt helpers are intentionally duplicated rather than
// extracted into a shared module — they are small, mechanical, and
// the two CLIs may diverge as the PR-flow gains agent-specific cues.
//
// Run:
//   node dist/benchmarks/falsification-corpus/cli/label-pr.js <entryId>
//        [--raw <dir>] [--labels <dir>] [--replace]

import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import {
  LABELING_RULES_PROMPT,
  BROKEN_CATEGORIES,
  parseBrokenCategories,
  validateGroundTruthLabel,
} from '../label-rules';
import { writeLabel } from '../label-store';
import { loadPrCorpus } from '../../real-corpus/loader';
import type {
  BrokenCategory,
  GroundTruthLabel,
  UnlabeledPrCorpusEntry,
} from '../../real-corpus/schema';

interface LabelPrCliArgs {
  entryId: string;
  rawDir: string;
  labelsDir: string;
  replace: boolean;
}

/** Runs the interactive PR-shaped hand-labeling CLI. */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const corpus = await loadPrCorpus(args.rawDir);
  const entry = corpus.find((item) => item.id === args.entryId);
  if (entry === undefined) {
    throw new Error(
      `${args.entryId} [label-pr]: entry id not found under ${path.resolve(args.rawDir)}`,
    );
  }
  await printEntryForReview(entry, args.rawDir);
  const rl = readline.createInterface({ input, output });
  try {
    await requireReadConfirmation(rl);
    const label = await promptForLabel(rl);
    const labelPath = await writeLabel(args.labelsDir, entry.id, label, {
      replace: args.replace,
    });
    process.stdout.write(`Wrote ${labelPath}\n`);
  } finally {
    rl.close();
  }
}

async function printEntryForReview(
  entry: UnlabeledPrCorpusEntry,
  rawDir: string,
): Promise<void> {
  process.stdout.write(`${LABELING_RULES_PROMPT}\n\n`);
  process.stdout.write('Entry\n');
  process.stdout.write(`ID: ${entry.id}\n`);
  process.stdout.write(`Repository: ${entry.pr.repository}\n`);
  process.stdout.write(`PR: #${entry.pr.number} by ${entry.pr.author}\n`);
  process.stdout.write(`Head/Base: ${entry.pr.headSha} / ${entry.pr.baseSha}\n`);
  process.stdout.write(`Branch: ${entry.pr.headRef}\n`);
  process.stdout.write(
    `Attribution: ${entry.agent.vendor} (confidence=${entry.agent.confidence}, ` +
      `source=${entry.agent.source})\n`,
  );
  process.stdout.write('\nPR Title\n');
  process.stdout.write(`${entry.pr.title}\n`);
  process.stdout.write('\nPR Body\n');
  process.stdout.write(`${entry.pr.body || '(empty body)'}\n`);
  process.stdout.write('\nUnified Diff\n');
  process.stdout.write(await readVendoredDiff(rawDir, entry));
}

async function readVendoredDiff(
  rawDir: string,
  entry: UnlabeledPrCorpusEntry,
): Promise<string> {
  const diskPath = path.join(rawDir, entry.vendoredDiffPath);
  try {
    return await fs.readFile(diskPath, 'utf8');
  } catch (err) {
    throw new Error(
      `${entry.id} [label-pr]: failed to read vendored diff at ${diskPath}: ${(err as Error).message}`,
      { cause: err },
    );
  }
}

async function requireReadConfirmation(rl: readline.Interface): Promise<void> {
  const answer = await rl.question(
    '\nType READ to confirm you read the full PR body and full unified diff: ',
  );
  if (answer.trim() !== 'READ') {
    throw new Error('label-pr [confirmation]: aborted (full-review confirmation not provided)');
  }
}

async function promptForLabel(rl: readline.Interface): Promise<GroundTruthLabel> {
  const verdict = await promptVerdict(rl);
  const rationale = await promptRationale(rl);
  const brokenCategories =
    verdict === 'broken' ? await promptBrokenCategories(rl) : undefined;
  const labeledBy = await promptRequired(rl, 'Reviewer name: ');
  const reviewedBy =
    verdict === 'ambiguous'
      ? await promptRequired(rl, 'Second reviewer name (required for ambiguous): ')
      : await promptOptional(rl, 'Second reviewer name (optional unless sampled): ');
  const label: GroundTruthLabel = {
    verdict,
    rationale,
    ...(brokenCategories !== undefined ? { brokenCategories } : {}),
    labeledBy,
    labeledAt: new Date().toISOString(),
    ...(reviewedBy !== undefined ? { reviewedBy } : {}),
  };
  const issues = validateGroundTruthLabel(label);
  if (issues.length > 0) {
    throw new Error(`label-pr [validation]: ${issues.join('; ')}`);
  }
  return label;
}

async function promptVerdict(rl: readline.Interface): Promise<GroundTruthLabel['verdict']> {
  for (;;) {
    const answer = (await rl.question('Verdict (clean / broken / ambiguous): ')).trim();
    if (answer === 'clean' || answer === 'broken' || answer === 'ambiguous') return answer;
    process.stdout.write('Enter clean, broken, or ambiguous.\n');
  }
}

async function promptRationale(rl: readline.Interface): Promise<string> {
  for (;;) {
    const answer = (await rl.question('Rationale (at least three sentences): ')).trim();
    const testLabel: GroundTruthLabel = {
      verdict: 'clean',
      rationale: answer,
      labeledBy: 'validator',
      labeledAt: new Date().toISOString(),
    };
    if (!validateGroundTruthLabel(testLabel).some((issue) => issue.includes('rationale'))) {
      return answer;
    }
    process.stdout.write('Rationale must be at least three sentences with concrete diff evidence.\n');
  }
}

async function promptBrokenCategories(rl: readline.Interface): Promise<BrokenCategory[]> {
  process.stdout.write(`Broken categories: ${BROKEN_CATEGORIES.join(', ')}\n`);
  for (;;) {
    const answer = await rl.question('Broken categories (comma-separated): ');
    const categories = parseBrokenCategories(answer);
    const issues = validateGroundTruthLabel({
      verdict: 'broken',
      rationale: 'First sentence. Second sentence. Third sentence.',
      brokenCategories: categories,
      labeledBy: 'validator',
      labeledAt: new Date().toISOString(),
    });
    if (issues.length === 0) return categories;
    process.stdout.write(`${issues.join('; ')}\n`);
  }
}

async function promptRequired(rl: readline.Interface, prompt: string): Promise<string> {
  for (;;) {
    const answer = (await rl.question(prompt)).trim();
    if (answer.length > 0) return answer;
    process.stdout.write('This field is required.\n');
  }
}

async function promptOptional(
  rl: readline.Interface,
  prompt: string,
): Promise<string | undefined> {
  const answer = (await rl.question(prompt)).trim();
  return answer.length > 0 ? answer : undefined;
}

function parseArgs(argv: string[]): LabelPrCliArgs {
  let entryId: string | undefined;
  let rawDir = path.resolve('benchmarks/real-corpus/raw');
  let labelsDir = path.resolve('benchmarks/real-corpus/labels');
  let replace = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--replace') {
      replace = true;
    } else if (arg === '--raw') {
      rawDir = path.resolve(requireValue(argv, (i += 1), '--raw'));
    } else if (arg === '--labels') {
      labelsDir = path.resolve(requireValue(argv, (i += 1), '--labels'));
    } else if (arg?.startsWith('--')) {
      throw new Error(`label-pr [args]: unknown option ${arg}`);
    } else if (entryId === undefined && arg !== undefined) {
      entryId = arg;
    } else {
      throw new Error('label-pr [args]: expected exactly one entry id');
    }
  }
  if (entryId === undefined) {
    throw new Error(
      'label-pr [args]: usage node dist/benchmarks/falsification-corpus/cli/label-pr.js <entryId> [--raw <dir>] [--labels <dir>] [--replace]',
    );
  }
  return { entryId, rawDir, labelsDir, replace };
}

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`label-pr [args]: ${option} requires a value`);
  }
  return value;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
