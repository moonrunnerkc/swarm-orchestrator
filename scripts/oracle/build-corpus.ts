// Builds the defect-injection oracle corpus. Takes the presumed-clean
// real PRs (real-corpus entries labeled `clean`), runs the injector
// registry over them, and writes one broken-variant diff plus a stamped
// label per injection under benchmarks/oracle-corpus/<category>/<injector>/.
//
// Deterministic: the output directory is rebuilt from scratch each run and
// the runner is seeded by registry index, so two runs on the same inputs
// produce byte-identical diffs, labels, INDEX.md and injection-coverage.md. CI runs
// it twice and diffs the tree.
//
// Usage: node dist/scripts/oracle/build-corpus.js [--cap N]

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { loadRealCorpus, readRealDiff, repoRoot } from '../benchmarks/lib/corpora';
import {
  runInjectors,
  type CleanPrInput,
  type InjectedCase,
  type InjectorTally,
} from '../../src/audit/oracle/inject/injection-runner';

const OUT = ['benchmarks', 'oracle-corpus'];

function sourcePrUrl(repository: string, prNumber: number): string {
  return `https://github.com/${repository}/pull/${prNumber}`;
}

async function loadCleanPrs(root: string): Promise<CleanPrInput[]> {
  const { labeled } = await loadRealCorpus(root);
  const out: CleanPrInput[] = [];
  for (const entry of labeled) {
    if (entry.groundTruth.verdict !== 'clean') continue;
    out.push({
      prId: entry.id,
      sourcePrUrl: sourcePrUrl(entry.pr.repository, entry.pr.number),
      prTitle: entry.pr.title,
      cleanDiff: readRealDiff(entry, root),
    });
  }
  return out;
}

function writeCases(root: string, cases: InjectedCase[]): { path: string; sha: string }[] {
  const outRoot = path.join(root, ...OUT);
  fs.mkdirSync(outRoot, { recursive: true });
  // Remove only the category defect directories this build owns; sibling
  // report files (per-detector-recall.md, COVERAGE.md, ...) live here too
  // and must survive a rebuild. Without this, oracle:build wipes them and
  // the case-insensitive COVERAGE.md/coverage.md collision corrupts state.
  for (const entry of fs.readdirSync(outRoot)) {
    const full = path.join(outRoot, entry);
    if (fs.statSync(full).isDirectory()) fs.rmSync(full, { recursive: true, force: true });
  }
  const written: { path: string; sha: string }[] = [];
  for (const c of cases) {
    const dir = path.join(outRoot, c.category, c.injectorId);
    fs.mkdirSync(dir, { recursive: true });
    const diffRel = path.join(c.category, c.injectorId, `${c.prId}.diff`);
    const labelRel = path.join(c.category, c.injectorId, `${c.prId}.label.json`);
    fs.writeFileSync(path.join(outRoot, diffRel), c.brokenDiff);
    fs.writeFileSync(
      path.join(outRoot, labelRel),
      `${JSON.stringify(c.label, null, 2)}\n`,
    );
    written.push({ path: diffRel, sha: c.label.sha256 });
    written.push({ path: labelRel, sha: sha256File(path.join(outRoot, labelRel)) });
  }
  return written;
}

function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function corpusSha(written: { path: string; sha: string }[]): string {
  const lines = written
    .map((w) => `${w.path.split(path.sep).join('/')} ${w.sha}`)
    .sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

function renderIndex(
  cases: InjectedCase[],
  tallies: InjectorTally[],
  digest: string,
  prCount: number,
): string {
  const lines: string[] = [];
  lines.push('# Oracle corpus index');
  lines.push('');
  lines.push(
    'Constructively-injected defects over presumed-clean real PRs. Each ' +
      'entry is a broken-variant `.diff` plus a `.label.json` stamping the ' +
      'category, injector, hunk, line range, source PR, and a sha256 over the ' +
      'diff. Rebuild with `npm run oracle:build`.',
  );
  lines.push('');
  lines.push(`- source PRs (presumed-clean carriers): ${prCount}`);
  lines.push(`- total injected defects: ${cases.length}`);
  lines.push(`- corpus sha256: \`${digest}\``);
  lines.push('');
  lines.push('| injector | category | injected | refused (no carrier) | dropped to cap |');
  lines.push('|---|---|---|---|---|');
  for (const t of tallies) {
    lines.push(
      `| ${t.injectorId} | ${t.category} | ${t.injected} | ${t.refused} | ${t.droppedToCap} |`,
    );
  }
  lines.push('');
  lines.push('## Every injected defect');
  lines.push('');
  lines.push('| category | injector | pr | file | lines | sha256 (12) |');
  lines.push('|---|---|---|---|---|---|');
  for (const c of [...cases].sort((a, b) => `${a.category}${a.prId}`.localeCompare(`${b.category}${b.prId}`))) {
    lines.push(
      `| ${c.category} | ${c.injectorId} | ${c.prId} | ${c.label.file} | ` +
        `${c.label.startLine}-${c.label.endLine} | ${c.label.sha256.slice(0, 12)} |`,
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderCoverage(cases: InjectedCase[], tallies: InjectorTally[]): string {
  const lines: string[] = [];
  lines.push('# Oracle corpus coverage');
  lines.push('');
  lines.push(
    'Per-category injection counts, how injections spread across source PRs, ' +
      'and one sample diff per injector. Built by `npm run oracle:build`.',
  );
  lines.push('');
  lines.push('| category | injector | injected | distinct source PRs |');
  lines.push('|---|---|---|---|');
  for (const t of tallies) {
    const prs = new Set(cases.filter((c) => c.injectorId === t.injectorId).map((c) => c.prId));
    lines.push(`| ${t.category} | ${t.injectorId} | ${t.injected} | ${prs.size} |`);
  }
  lines.push('');
  lines.push('## Construction note');
  lines.push('');
  lines.push(
    'Injectors are append-only: each splices a self-contained defect hunk ' +
      'into a real carrier file from the PR (or a new file in a real PR ' +
      'directory), chosen by file-kind analysis. They never rewrite an ' +
      'existing hunk, so the carrier PR content is preserved and the label ' +
      'line range points at the injected hunk. Categories needing a deletion ' +
      '(assertion-strip, test-relaxation, no-op-fix, fake-refactor, ' +
      'exception-rethrow, cheat-mock-mutation) require a real carrier file of ' +
      'the right kind and refuse PRs without one; the refused counts in ' +
      'INDEX.md make that visible.',
  );
  lines.push('');
  for (const t of tallies) {
    const sample = cases.find((c) => c.injectorId === t.injectorId);
    if (sample === undefined) continue;
    lines.push(`### ${t.injectorId} (${t.category})`);
    lines.push('');
    lines.push('```diff');
    lines.push(sampleHunk(sample.brokenDiff).trimEnd());
    lines.push('```');
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/** The injected hunk is always the last hunk in the diff. */
function sampleHunk(diff: string): string {
  const idx = diff.lastIndexOf('\n@@ ');
  if (idx === -1) return diff.slice(-600);
  return diff.slice(idx + 1);
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const capArg = argv.indexOf('--cap');
  const cap = capArg !== -1 ? Number(argv[capArg + 1]) : 25;
  const root = repoRoot();
  const prs = await loadCleanPrs(root);
  const { cases, tallies } = runInjectors(prs, { perInjectorCap: cap });
  const written = writeCases(root, cases);
  const digest = corpusSha(written);
  const outRoot = path.join(root, ...OUT);
  fs.writeFileSync(path.join(outRoot, 'INDEX.md'), renderIndex(cases, tallies, digest, prs.length));
  fs.writeFileSync(path.join(outRoot, 'injection-coverage.md'), renderCoverage(cases, tallies));

  process.stdout.write(
    `oracle:build carriers=${prs.length} injected=${cases.length} ` +
      `categories=${new Set(cases.map((c) => c.category)).size}/12 sha=${digest.slice(0, 12)}\n`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`build-corpus: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
}

export { main };
