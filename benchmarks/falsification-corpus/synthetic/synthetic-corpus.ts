import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  attachAttestationNote,
  createAttestationEnvelope,
  type SignedAttestation,
} from '../../../src/verification';
import { validateGroundTruthLabel } from '../label-rules';
import type { BrokenCategory, CorpusEntry, GroundTruthLabel } from '../schema';
import { SYNTHETIC_CASES, type SyntheticCaseSpec } from './catalog';

export interface SyntheticCorpus {
  entries: CorpusEntry[];
  testSpecDir: string;
}

/** Materializes synthetic git repos and returns labeled corpus entries. */
export function loadSyntheticCorpus(syntheticRoot: string, options: {
  categories?: readonly BrokenCategory[];
} = {}): SyntheticCorpus {
  const root = path.resolve(syntheticRoot);
  const testSpecDir = path.join(root, 'test-specs');
  fs.mkdirSync(testSpecDir, { recursive: true });
  const categories = options.categories === undefined ? undefined : new Set(options.categories);
  const specs = SYNTHETIC_CASES.filter(spec => categories === undefined || categories.has(spec.category));
  const entries = specs.flatMap(spec => materializeCase(root, testSpecDir, spec));
  return { entries: entries.sort((left, right) => left.id.localeCompare(right.id)), testSpecDir };
}

function materializeCase(root: string, testSpecDir: string, spec: SyntheticCaseSpec): CorpusEntry[] {
  const caseDir = path.join(root, spec.category, spec.id);
  const repoPath = path.join(caseDir, 'repo');
  fs.rmSync(repoPath, { recursive: true, force: true });
  fs.mkdirSync(repoPath, { recursive: true });
  writeCaseFiles(caseDir, spec);
  git(repoPath, ['init', '-b', 'main']);
  git(repoPath, ['config', 'user.name', 'Synthetic Corpus']);
  git(repoPath, ['config', 'user.email', 'synthetic@example.test']);
  writeFiles(repoPath, spec.baseFiles);
  commitAll(repoPath, 'base');
  const baseCommit = git(repoPath, ['rev-parse', 'HEAD']);

  git(repoPath, ['switch', '-c', 'broken']);
  writeFiles(repoPath, spec.brokenFiles);
  commitAll(repoPath, `broken ${spec.category}`);
  const brokenCommit = git(repoPath, ['rev-parse', 'HEAD']);
  attachSyntheticAttestation(repoPath, brokenCommit, spec, 'broken');

  git(repoPath, ['switch', 'main']);
  git(repoPath, ['switch', '-c', 'clean']);
  writeFiles(repoPath, spec.cleanFiles);
  commitAll(repoPath, `clean ${spec.category}`);
  const cleanCommit = git(repoPath, ['rev-parse', 'HEAD']);
  attachSyntheticAttestation(repoPath, cleanCommit, spec, 'clean');
  git(repoPath, ['switch', 'main']);

  const brokenId = syntheticId(spec, 'broken');
  const cleanId = syntheticId(spec, 'clean');
  writeTestSpec(testSpecDir, brokenId, spec);
  writeTestSpec(testSpecDir, cleanId, spec);
  return [
    entry(spec, caseDir, repoPath, baseCommit, brokenCommit, brokenLabel(spec), 'broken'),
    entry(spec, caseDir, repoPath, baseCommit, cleanCommit, cleanLabel(spec), 'clean'),
  ];
}

function entry(
  spec: SyntheticCaseSpec,
  caseDir: string,
  repoPath: string,
  baseCommit: string,
  patchCommit: string,
  groundTruth: GroundTruthLabel,
  variant: 'broken' | 'clean',
): CorpusEntry {
  const issues = validateGroundTruthLabel(groundTruth);
  if (issues.length > 0) {
    throw new Error(`${syntheticId(spec, variant)} [label]: ${issues.join('; ')}`);
  }
  return {
    id: syntheticId(spec, variant),
    source: 'synthetic-adversarial',
    goalText: spec.goalText,
    repoPath,
    baseCommit,
    patchCommit,
    agentIdentity: { cli: 'unknown', model: 'synthetic' },
    transcriptPath: path.join(caseDir, 'share.generated.md'),
    groundTruth,
    metadata: {
      capturedAt: '2026-04-29T00:00:00.000Z',
      runDir: caseDir,
      stepNumber: variant === 'broken' ? 1 : 2,
    },
  };
}

function writeCaseFiles(caseDir: string, spec: SyntheticCaseSpec): void {
  write(path.join(caseDir, 'goal.generated.txt'), `${spec.goalText}\n`);
  write(path.join(caseDir, 'share.generated.md'), [
    '# Synthetic Agent Session Transcript',
    '',
    `Category: ${spec.category}`,
    `Case: ${spec.id}`,
    '',
  ].join('\n'));
  write(path.join(caseDir, 'broken.label.generated.json'), JSON.stringify(brokenLabel(spec), null, 2) + '\n');
  write(path.join(caseDir, 'clean.label.generated.json'), JSON.stringify(cleanLabel(spec), null, 2) + '\n');
}

function writeTestSpec(testSpecDir: string, entryId: string, spec: SyntheticCaseSpec): void {
  write(path.join(testSpecDir, `${entryId}.test-spec.json`), JSON.stringify({
    regressionCommand: 'node test/regression.test.js',
    ...(spec.allowedTestFiles !== undefined ? { allowedTestFiles: spec.allowedTestFiles } : {}),
  }, null, 2) + '\n');
}

function brokenLabel(spec: SyntheticCaseSpec): GroundTruthLabel {
  return {
    verdict: 'broken',
    rationale: `The synthetic broken patch intentionally exercises ${spec.category}. It is not a valid fix for the stated goal. The generated diff contains the minimal pattern needed to calibrate that layer.`,
    brokenCategories: [spec.category],
    labeledBy: 'synthetic-author',
    labeledAt: '2026-04-29T00:00:00.000Z',
  };
}

function cleanLabel(spec: SyntheticCaseSpec): GroundTruthLabel {
  return {
    verdict: 'clean',
    rationale: `The synthetic clean patch applies the intended fix for ${spec.category}. It avoids the adversarial pattern used in the paired broken branch. The diff is the control case for false-positive calibration.`,
    labeledBy: 'synthetic-author',
    labeledAt: '2026-04-29T00:00:00.000Z',
  };
}

function syntheticId(spec: SyntheticCaseSpec, variant: 'broken' | 'clean'): string {
  return `synthetic-${spec.category}-${spec.id}-${variant}`;
}

function attachSyntheticAttestation(
  repoPath: string,
  commit: string,
  spec: SyntheticCaseSpec,
  variant: 'broken' | 'clean',
): void {
  const envelope = createAttestationEnvelope({
    repoPath,
    commit,
    goalText: spec.goalText,
    planHash: `synthetic-${spec.category}-${spec.id}`,
    agent: { tool: 'synthetic', version: '1.0.0', model: 'synthetic' },
    transcript: `synthetic ${variant} transcript for ${spec.category}/${spec.id}`,
    layerResults: [],
    compositeScore: variant === 'clean' ? 1 : 0,
    timestamp: '2026-04-29T00:00:00.000Z',
  });
  const attestation: SignedAttestation = {
    envelope,
    signature: {
      kind: 'unsigned-test',
      signature: createHash('sha256').update(JSON.stringify(envelope)).digest('hex'),
    },
  };
  attachAttestationNote(repoPath, commit, attestation);
}

function writeFiles(repoPath: string, files: Record<string, string>): void {
  for (const [relativePath, content] of Object.entries(files)) {
    write(path.join(repoPath, relativePath), content);
  }
}

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  if (filePath.includes(`${path.sep}node_modules${path.sep}.bin${path.sep}`)) {
    fs.chmodSync(filePath, 0o755);
  }
}

function commitAll(repoPath: string, message: string): void {
  git(repoPath, ['add', '.']);
  git(repoPath, ['commit', '-m', message]);
}

function git(repoPath: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Synthetic Corpus',
      GIT_AUTHOR_EMAIL: 'synthetic@example.test',
      GIT_COMMITTER_NAME: 'Synthetic Corpus',
      GIT_COMMITTER_EMAIL: 'synthetic@example.test',
    },
  }).trim();
}
