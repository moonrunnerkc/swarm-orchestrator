import { execFileSync } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentCli } from './schema';
import { createCorpusIssue, type CorpusStructureIssue } from './loader-issues';

interface JsonRecord {
  [key: string]: unknown;
}

interface SessionStep {
  stepNumber: number;
}

export interface ParsedSession {
  goal: string;
  steps: SessionStep[];
  branchMap: Record<string, string>;
  transcripts: Record<string, string>;
}

export interface ResolvedCommits {
  baseCommit: string;
  patchCommit: string;
}

/** Finds swarm run directories while skipping embedded repos and dependencies. */
export async function findRunDirs(corpusRoot: string): Promise<string[]> {
  const runDirs: string[] = [];

  async function walk(current: string): Promise<void> {
    const dirents = await fs.readdir(current, { withFileTypes: true });
    for (const dirent of dirents) {
      if (!dirent.isDirectory() || shouldSkipDir(dirent.name)) {
        continue;
      }
      const next = path.join(current, dirent.name);
      if (dirent.name.startsWith('swarm-') && path.basename(path.dirname(next)) === 'runs') {
        runDirs.push(next);
        continue;
      }
      await walk(next);
    }
  }

  await walk(corpusRoot);
  return runDirs.sort();
}

/** Reads a JSON object and appends a corpus issue instead of throwing. */
export async function readJsonObject(
  filePath: string,
  runDir: string,
  issues: CorpusStructureIssue[],
): Promise<JsonRecord | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (isRecord(parsed)) {
      return parsed;
    }
    issues.push(createCorpusIssue(runDir, 'metadata', `${filePath} does not contain a JSON object`, 'Replace the malformed metadata file.'));
  } catch (error: unknown) {
    issues.push(createCorpusIssue(runDir, 'metadata', `${filePath} could not be read: ${reasonOf(error)}`, 'Restore the missing or unreadable metadata file.'));
  }
  return undefined;
}

/** Parses the subset of session-state.json required by the corpus loader. */
export function parseSession(sessionState: JsonRecord | undefined): ParsedSession | undefined {
  const graph = readRecord(sessionState, 'graph');
  const goal = readString(graph, 'goal');
  const rawSteps = readArray(graph, 'steps');
  const branchMap = readStringRecord(sessionState, 'branchMap');
  const transcripts = readStringRecord(sessionState, 'transcripts');
  if (goal === undefined || rawSteps === undefined || branchMap === undefined || transcripts === undefined) {
    return undefined;
  }
  const steps = rawSteps.map(parseStep).filter((step): step is SessionStep => step !== undefined);
  return steps.length === rawSteps.length ? { goal, steps, branchMap, transcripts } : undefined;
}

/** Validates required transcript and verification files for a single step. */
export async function validateStepFiles(
  runDir: string,
  session: ParsedSession,
  stepNumber: number,
): Promise<CorpusStructureIssue[]> {
  const issues: CorpusStructureIssue[] = [];
  const transcriptPath = resolveTranscriptPath(runDir, session, stepNumber);
  const verificationPath = path.join(runDir, 'verification', `step-${stepNumber}-verification.md`);
  if (!(await exists(transcriptPath))) {
    issues.push(createCorpusIssue(runDir, `step-${stepNumber}`, `missing share.md at ${transcriptPath}`, 'Restore the step transcript or remove this step from the corpus.'));
  }
  if (!(await exists(verificationPath))) {
    issues.push(createCorpusIssue(runDir, `step-${stepNumber}`, `missing verification report at ${verificationPath}`, 'Restore verification/step-N-verification.md for this step.'));
  }
  return issues;
}

/** Resolves base and patch commits from the branch merge associated with a step. */
export function resolveStepCommits(
  repoPath: string,
  branchName: string,
  runDir: string,
  stepNumber: number,
  issues: CorpusStructureIssue[],
): ResolvedCommits | undefined {
  try {
    const branchHead = runGit(repoPath, ['rev-parse', '--verify', `refs/heads/${branchName}`]);
    const commits = readCommitGraph(repoPath);
    const merge = commits.find(commit => (
      commit.subject.includes(`Merge ${branchName}`) && commit.parents.includes(branchHead)
    ));
    const fallback = commits.find(commit => commit.sha === branchHead && commit.parents.length >= 2);
    const resolved = merge ?? fallback;
    if (resolved === undefined || resolved.parents[0] === undefined) {
      issues.push(createCorpusIssue(runDir, `step-${stepNumber}`, `missing merge commit for branch ${branchName}`, 'Restore the merge commit or remove this step from the corpus.'));
      return undefined;
    }
    return { baseCommit: resolved.parents[0], patchCommit: resolved.sha };
  } catch (error: unknown) {
    issues.push(createCorpusIssue(runDir, `step-${stepNumber}`, `could not resolve git commits for branch ${branchName}: ${reasonOf(error)}`, 'Ensure the target repo has the swarm step branch and merge commit.'));
    return undefined;
  }
}

/** Resolves the transcript path recorded for a step to an absolute path. */
export function resolveTranscriptPath(runDir: string, session: ParsedSession, stepNumber: number): string {
  const recorded = session.transcripts[String(stepNumber)];
  if (recorded !== undefined) {
    return path.resolve(runDir, recorded);
  }
  return path.join(runDir, 'steps', `step-${stepNumber}`, 'share.md');
}

/** Detects the agent CLI from run metadata, model attribution, and corpus path. */
export function detectAgentCli(
  metrics: JsonRecord | undefined,
  costAttribution: JsonRecord | undefined,
  repoRelativePath: string,
): AgentCli {
  const model = (readString(costAttribution, 'modelUsed') ?? readString(metrics, 'model') ?? '').toLowerCase();
  const evidence = `${JSON.stringify(metrics)} ${JSON.stringify(costAttribution)} ${repoRelativePath}`.toLowerCase();
  if (evidence.includes('teams')) return 'claude-code-teams';
  if (evidence.includes('copilot')) return 'copilot';
  if (evidence.includes('codex') || model.startsWith('gpt-')) return 'codex';
  if (evidence.includes('claude') || model.includes('claude')) return 'claude-code';
  return 'unknown';
}

/** Builds the stable entry id prefix for a run's repository. */
export function buildRunSlug(corpusRoot: string, repoPath: string): string {
  const parts = path.relative(corpusRoot, repoPath).split(path.sep).filter(Boolean);
  if (parts[0] === 'target' && parts[1] !== undefined) {
    return `round1-${sanitizeId(parts[1])}`;
  }
  if (parts[0] === 'round-2-target' && parts[1] !== undefined) {
    return `round2-${sanitizeId(parts[1])}`;
  }
  return sanitizeId(parts.join('-'));
}

/** Parses a swarm run directory timestamp into ISO-8601 format. */
export function parseRunTimestamp(runName: string): string | undefined {
  const match = /^swarm-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(runName);
  return match === null ? undefined : `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
}

function readCommitGraph(repoPath: string): Array<{ sha: string; parents: string[]; subject: string }> {
  return runGit(repoPath, ['log', '--all', '--format=%H%x00%P%x00%s'])
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => {
      const [sha = '', parentsText = '', subject = ''] = line.split('\0');
      return { sha, parents: parentsText.split(' ').filter(Boolean), subject };
    });
}

function runGit(repoPath: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function parseStep(value: unknown): SessionStep | undefined {
  if (!isRecord(value) || typeof value.stepNumber !== 'number') {
    return undefined;
  }
  return { stepNumber: value.stepNumber };
}

function readRecord(record: JsonRecord | undefined, key: string): JsonRecord | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

function readArray(record: JsonRecord | undefined, key: string): unknown[] | undefined {
  const value = record?.[key];
  return Array.isArray(value) ? value : undefined;
}

function readString(record: JsonRecord | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' ? value : undefined;
}

function readStringRecord(record: JsonRecord | undefined, key: string): Record<string, string> | undefined {
  const value = record?.[key];
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === 'string')) {
    return undefined;
  }
  return Object.fromEntries(entries);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function shouldSkipDir(name: string): boolean {
  return name === '.git' || name === 'node_modules' || name === 'dist';
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
