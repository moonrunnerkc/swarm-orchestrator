import { execFileSync } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { LABELING_RULES_PROMPT, BROKEN_CATEGORIES, parseBrokenCategories, validateGroundTruthLabel } from '../label-rules';
import { writeLabel } from '../label-store';
import { loadCorpus } from '../loader';
import type { GroundTruthLabel, UnlabeledCorpusEntry } from '../schema';

interface LabelCliArgs {
  entryId: string;
  corpusDir: string;
  labelsDir: string;
  replace: boolean;
}

/** Runs the interactive hand-labeling CLI. */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const corpus = await loadCorpus(args.corpusDir);
  const entry = corpus.find(item => item.id === args.entryId);
  if (entry === undefined) {
    throw new Error(`${args.entryId} [label]: entry id not found in ${path.resolve(args.corpusDir)}`);
  }

  await printEntryForReview(entry);
  const rl = readline.createInterface({ input, output });
  try {
    await requireReadConfirmation(rl);
    const label = await promptForLabel(rl);
    const labelPath = await writeLabel(args.labelsDir, entry.id, label, { replace: args.replace });
    console.log(`Wrote ${labelPath}`);
  } finally {
    rl.close();
  }
}

async function printEntryForReview(entry: UnlabeledCorpusEntry): Promise<void> {
  console.log(LABELING_RULES_PROMPT);
  console.log('\nEntry');
  console.log(`ID: ${entry.id}`);
  console.log(`Repo: ${entry.repoPath}`);
  console.log(`Base: ${entry.baseCommit}`);
  console.log(`Patch: ${entry.patchCommit}`);
  console.log('\nGoal');
  console.log(entry.goalText);
  console.log('\nPatch Diff');
  console.log(readPatchDiff(entry));
  console.log('\nTranscript');
  console.log(await fs.readFile(entry.transcriptPath, 'utf8'));
}

async function requireReadConfirmation(rl: readline.Interface): Promise<void> {
  const answer = await rl.question('\nType READ to confirm you read the full patch diff and full transcript: ');
  if (answer.trim() !== 'READ') {
    throw new Error('label [confirmation]: label aborted because full-review confirmation was not provided');
  }
}

async function promptForLabel(rl: readline.Interface): Promise<GroundTruthLabel> {
  const verdict = await promptVerdict(rl);
  const rationale = await promptRationale(rl);
  const brokenCategories = verdict === 'broken' ? await promptBrokenCategories(rl) : undefined;
  const labeledBy = await promptRequired(rl, 'Reviewer name: ');
  const reviewedBy = verdict === 'ambiguous'
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
    throw new Error(`label [validation]: ${issues.join('; ')}`);
  }
  return label;
}

async function promptVerdict(rl: readline.Interface): Promise<GroundTruthLabel['verdict']> {
  for (;;) {
    const answer = (await rl.question('Verdict (clean / broken / ambiguous): ')).trim();
    if (answer === 'clean' || answer === 'broken' || answer === 'ambiguous') {
      return answer;
    }
    console.log('Enter clean, broken, or ambiguous.');
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
    if (!validateGroundTruthLabel(testLabel).some(issue => issue.includes('rationale'))) {
      return answer;
    }
    console.log('Rationale must be at least three sentences with concrete patch evidence.');
  }
}

async function promptBrokenCategories(rl: readline.Interface) {
  console.log(`Broken categories: ${BROKEN_CATEGORIES.join(', ')}`);
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
    console.log(issues.join('; '));
  }
}

async function promptRequired(rl: readline.Interface, prompt: string): Promise<string> {
  for (;;) {
    const answer = (await rl.question(prompt)).trim();
    if (answer.length > 0) return answer;
    console.log('This field is required.');
  }
}

async function promptOptional(rl: readline.Interface, prompt: string): Promise<string | undefined> {
  const answer = (await rl.question(prompt)).trim();
  return answer.length > 0 ? answer : undefined;
}

function readPatchDiff(entry: UnlabeledCorpusEntry): string {
  return execFileSync('git', ['diff', `${entry.baseCommit}..${entry.patchCommit}`], {
    cwd: entry.repoPath,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parseArgs(argv: string[]): LabelCliArgs {
  let entryId: string | undefined;
  let corpusDir = path.resolve('verification-runs');
  let labelsDir = path.resolve('benchmarks/falsification-corpus/labels');
  let replace = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--replace') {
      replace = true;
    } else if (arg === '--corpus') {
      corpusDir = path.resolve(requireValue(argv, i += 1, '--corpus'));
    } else if (arg === '--labels') {
      labelsDir = path.resolve(requireValue(argv, i += 1, '--labels'));
    } else if (arg?.startsWith('--')) {
      throw new Error(`label [args]: unknown option ${arg}`);
    } else if (entryId === undefined && arg !== undefined) {
      entryId = arg;
    } else {
      throw new Error('label [args]: expected exactly one entry id');
    }
  }
  if (entryId === undefined) {
    throw new Error('label [args]: usage node dist/benchmarks/falsification-corpus/cli/label.js <entryId> [--replace]');
  }
  return { entryId, corpusDir, labelsDir, replace };
}

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`label [args]: ${option} requires a value`);
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
