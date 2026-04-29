import * as path from 'path';
import { createCorpusIssue, formatIssueMessage, type CorpusStructureIssue } from './loader-issues';
import {
  buildRunSlug,
  detectAgentCli,
  findRunDirs,
  parseRunTimestamp,
  parseSession,
  readJsonObject,
  resolveStepCommits,
  resolveTranscriptPath,
  validateStepFiles,
} from './loader-support';
import type { UnlabeledCorpusEntry } from './schema';

export type { CorpusStructureIssue } from './loader-issues';

/** Error thrown when one or more verification run directories are unrunnable. */
export class CorpusLoaderError extends Error {
  readonly issues: readonly CorpusStructureIssue[];

  constructor(issues: readonly CorpusStructureIssue[]) {
    super(formatIssueMessage(issues));
    this.name = 'CorpusLoaderError';
    this.issues = issues;
  }
}

/** Loads verification-run corpus entries without fabricating hand labels. */
export async function loadCorpus(corpusDir: string): Promise<UnlabeledCorpusEntry[]> {
  const corpusRoot = path.resolve(corpusDir);
  const runDirs = await findRunDirs(corpusRoot);
  const entries: UnlabeledCorpusEntry[] = [];
  const issues: CorpusStructureIssue[] = [];

  for (const runDir of runDirs) {
    const loaded = await loadRunDir(corpusRoot, runDir);
    entries.push(...loaded.entries);
    issues.push(...loaded.issues);
  }

  for (const id of findDuplicates(entries.map(entry => entry.id))) {
    issues.push(createCorpusIssue(
      corpusRoot,
      'entry-id',
      `duplicate corpus entry id "${id}"`,
      'Add a stable disambiguator to the corpus entry id policy.',
    ));
  }

  if (issues.length > 0) {
    throw new CorpusLoaderError(issues);
  }

  return entries.sort((left, right) => left.id.localeCompare(right.id));
}

async function loadRunDir(
  corpusRoot: string,
  runDir: string,
): Promise<{ entries: UnlabeledCorpusEntry[]; issues: CorpusStructureIssue[] }> {
  const issues: CorpusStructureIssue[] = [];
  const repoPath = path.dirname(path.dirname(runDir));
  const sessionState = await readJsonObject(path.join(runDir, 'session-state.json'), runDir, issues);
  const metrics = await readJsonObject(path.join(runDir, 'metrics.json'), runDir, issues);
  const costAttribution = await readJsonObject(path.join(runDir, 'cost-attribution.json'), runDir, issues);
  const session = parseSession(sessionState);
  const capturedAt = parseRunTimestamp(path.basename(runDir));

  if (session === undefined) {
    issues.push(createCorpusIssue(runDir, 'session-state', 'session-state.json is missing graph goal, steps, transcripts, or branchMap', 'Regenerate the run metadata or remove this run from the corpus.'));
  }
  if (capturedAt === undefined) {
    issues.push(createCorpusIssue(runDir, 'metadata', `run directory name "${path.basename(runDir)}" does not contain a parseable swarm timestamp`, 'Use a swarm-YYYY-MM-DDTHH-mm-ss-SSSZ run directory name.'));
  }
  if (session === undefined || capturedAt === undefined) {
    return { entries: [], issues };
  }

  const entries: UnlabeledCorpusEntry[] = [];
  const model = typeof costAttribution?.modelUsed === 'string' ? costAttribution.modelUsed : undefined;
  const cli = detectAgentCli(metrics, costAttribution, path.relative(corpusRoot, repoPath));
  const runSlug = buildRunSlug(corpusRoot, repoPath);

  for (const step of session.steps) {
    const stepIssues = await validateStepFiles(runDir, session, step.stepNumber);
    issues.push(...stepIssues);
    const branchName = session.branchMap[String(step.stepNumber)];
    if (branchName === undefined) {
      issues.push(createCorpusIssue(runDir, `step-${step.stepNumber}`, 'missing branchMap entry for step', 'Restore branchMap in session-state.json.'));
      continue;
    }

    const commits = resolveStepCommits(repoPath, branchName, runDir, step.stepNumber, issues);
    if (commits === undefined || stepIssues.length > 0) {
      continue;
    }

    entries.push({
      id: `${runSlug}-step-${step.stepNumber}`,
      source: 'verification-run',
      goalText: session.goal,
      repoPath,
      baseCommit: commits.baseCommit,
      patchCommit: commits.patchCommit,
      agentIdentity: model === undefined ? { cli } : { cli, model },
      transcriptPath: resolveTranscriptPath(runDir, session, step.stepNumber),
      metadata: {
        capturedAt,
        runDir,
        stepNumber: step.stepNumber,
      },
    });
  }

  return { entries, issues };
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}
