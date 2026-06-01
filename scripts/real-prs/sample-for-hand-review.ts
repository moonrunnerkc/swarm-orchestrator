// Emit a stratified spot-check queue so a human can validate the arbiter's
// labels in a few minutes. Up to 20 findings, spread across repos and
// across the true-cheat / false-alarm / debatable buckets, as a Markdown
// table with an editable `my-label` column. The report reads any labels
// filled in here back and reports the hand-review-vs-arbiter delta.
//
// Usage: node dist/scripts/real-prs/sample-for-hand-review.js [--cap 20]

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import { arbiterLabelsFile, handReviewQueueFile, sourcesFile } from './lib/paths';
import type { ArbiterLabel, ArbiterVerdict, SourcePr, SourcesFile } from './lib/types';

const log = getLogger('real-prs:sample');

const BUCKETS: readonly ArbiterVerdict[] = ['true-cheat', 'false-alarm', 'debatable'];

function parseCap(argv: string[]): number {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--cap' && argv[i + 1] !== undefined) return Number(argv[i + 1]);
  }
  return 20;
}

// Round-robin across repos within a bucket so no single repo dominates the
// sample. Deterministic: labels are sorted by key first.
function pickSpreadAcrossRepos(labels: ArbiterLabel[], want: number): ArbiterLabel[] {
  const byRepo = new Map<string, ArbiterLabel[]>();
  for (const l of labels.slice().sort((a, b) => a.key.localeCompare(b.key))) {
    const list = byRepo.get(l.repo) ?? [];
    list.push(l);
    byRepo.set(l.repo, list);
  }
  const repos = [...byRepo.keys()].sort();
  const picked: ArbiterLabel[] = [];
  let progress = true;
  while (picked.length < want && progress) {
    progress = false;
    for (const repo of repos) {
      const list = byRepo.get(repo);
      if (list !== undefined && list.length > 0) {
        const next = list.shift();
        if (next !== undefined) {
          picked.push(next);
          progress = true;
        }
      }
      if (picked.length >= want) break;
    }
  }
  return picked;
}

function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

function main(): void {
  const cap = parseCap(process.argv.slice(2));
  if (!fs.existsSync(arbiterLabelsFile())) {
    log.error('no arbiter-labels.json; run real-prs:arbiter first');
    process.exit(1);
  }
  const labels = JSON.parse(fs.readFileSync(arbiterLabelsFile(), 'utf8')) as ArbiterLabel[];
  const sources = JSON.parse(fs.readFileSync(sourcesFile(), 'utf8')) as SourcesFile;
  const prByKey = new Map<string, SourcePr>();
  for (const pr of sources.prs) prByKey.set(`${pr.repo}#${pr.prNumber}`, pr);

  const inBuckets = labels.filter((l) => BUCKETS.includes(l.verdict));
  const total = inBuckets.length;
  // Proportional target per bucket, at least 1 where the bucket is
  // non-empty, summing to the cap.
  const selected: ArbiterLabel[] = [];
  for (const bucket of BUCKETS) {
    const inBucket = inBuckets.filter((l) => l.verdict === bucket);
    if (inBucket.length === 0) continue;
    const share = total === 0 ? 0 : Math.round((inBucket.length / total) * cap);
    const want = Math.max(1, Math.min(share, inBucket.length));
    selected.push(...pickSpreadAcrossRepos(inBucket, want));
  }
  const final = selected.slice(0, cap);

  const lines: string[] = [];
  lines.push('# Hand-review queue (arbiter spot-check)');
  lines.push('');
  lines.push(
    `${final.length} findings sampled across repos and the true-cheat / false-alarm / debatable ` +
      'buckets. Fill in the `my-label` column with your own call (true-cheat, false-alarm, ' +
      'debatable, or insufficient-context). The report computes the agreement between your labels ' +
      'and the arbiter on this sample if this file is filled in; it skips gracefully if not.',
  );
  lines.push('');
  lines.push('| # | PR | category | path | judge-path | arbiter | conf | my-label |');
  lines.push('|---|---|---|---|---|---|---|---|');
  final.forEach((l, i) => {
    const pr = prByKey.get(`${l.repo}#${l.prNumber}`);
    const url = pr?.url ?? '';
    const prCell = url.length > 0 ? `[${l.repo}#${l.prNumber}](${url}/files)` : `${l.repo}#${l.prNumber}`;
    const subjectPath = l.key.split(':')[2] ?? '';
    lines.push(
      `| ${i + 1} | ${prCell} | ${l.category} | ${truncate(subjectPath, 40)} | ${l.judgePath} | ` +
        `${l.verdict} | ${l.confidence.toFixed(2)} | |`,
    );
  });
  lines.push('');

  const out = handReviewQueueFile();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // Do not overwrite a queue the human has already started filling in.
  if (fs.existsSync(out)) {
    const prior = fs.readFileSync(out, 'utf8');
    if (/\|\s*(true-cheat|false-alarm|debatable|insufficient-context)\s*\|\s*$/m.test(prior)) {
      log.warn(`${out} already has hand labels; not overwriting. Delete it to regenerate.`);
      return;
    }
  }
  fs.writeFileSync(out, lines.join('\n') + '\n');
  log.info(`wrote ${final.length}-finding hand-review queue to ${out}`);
}

main();
