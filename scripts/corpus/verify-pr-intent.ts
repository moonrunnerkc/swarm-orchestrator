// Verification harness for the PR-intent severity-escalation layer.
//
// For every broken-labeled entry in benchmarks/real-corpus/, parses
// the PR title+body through pr-intent, runs the cheat detectors with
// the PR metadata threaded in, and reports:
//   - whether the entry has a fix-claim
//   - which detectors fired (any severity) on the entry
//   - which findings the intent layer escalated (intentUpgraded:true)
//
// Useful for sanity-checking that the layer behaves as designed on
// the labeled corpus: every broken-labeled entry whose PR carries a
// fix-claim should see at least one finding escalated. Vacuous PASS
// when no broken entry in the sample carries a fix-claim.
//
// Run: node dist/scripts/corpus/verify-pr-intent.js

import * as fs from 'fs/promises';
import * as path from 'path';
import { runCheatDetectors } from '../../src/audit/cheat-detector';
import { parsePrIntent } from '../../src/audit/cheat-detector/pr-intent';
import { loadPrCorpus, loadLabeledPrEntries } from '../../benchmarks/real-corpus/loader';
import { findRepoRoot } from './repo-root';

async function main(): Promise<void> {
  const repoRoot = findRepoRoot(__dirname);
  const rawDir = path.join(repoRoot, 'benchmarks', 'real-corpus', 'raw');
  const labelsDir = path.join(repoRoot, 'benchmarks', 'real-corpus', 'labels');
  const entries = await loadPrCorpus(rawDir);
  const { labeled } = await loadLabeledPrEntries(entries, labelsDir);
  const broken = labeled.filter((e) => e.groundTruth.verdict === 'broken');

  process.stdout.write(`Verifying intent-layer escalation across ${broken.length} broken-labeled entries.\n\n`);
  let withClaim = 0;
  let withClaimAndUpgrade = 0;
  let withClaimNoUpgrade = 0;

  for (const entry of broken) {
    const intent = parsePrIntent({ title: entry.pr.title, body: entry.pr.body });
    if (!intent.claimsFix) {
      process.stdout.write(`SKIP  ${entry.id}  (no fix-claim in title/body)\n`);
      continue;
    }
    withClaim += 1;

    const diffPath = path.join(rawDir, entry.vendoredDiffPath);
    const diff = await fs.readFile(diffPath, 'utf8');
    const result = await runCheatDetectors({
      unifiedDiff: diff,
      repoRoot,
      pr: {
        number: entry.pr.number,
        headSha: entry.pr.headSha,
        baseSha: entry.pr.baseSha,
        title: entry.pr.title,
        body: entry.pr.body,
        author: entry.pr.author,
        headRef: entry.pr.headRef,
        repository: entry.pr.repository,
      },
    });
    const upgraded = result.findings.filter((f) => f.intentUpgraded === true);
    const fired = Array.from(new Set(result.findings.map((f) => f.category)));
    if (upgraded.length > 0) {
      withClaimAndUpgrade += 1;
      const cats = Array.from(new Set(upgraded.map((f) => f.category))).join(', ');
      process.stdout.write(
        `PASS  ${entry.id}  claim="${intent.evidence}"  upgraded=[${cats}]\n`,
      );
    } else {
      withClaimNoUpgrade += 1;
      process.stdout.write(
        `MISS  ${entry.id}  claim="${intent.evidence}"  detectors_fired=[${fired.join(', ') || 'none'}]  ` +
          `(no finding eligible for upgrade; detectors did not produce warn/info findings on this entry)\n`,
      );
    }
  }

  process.stdout.write(
    `\nSummary: ${withClaim}/${broken.length} broken entries carry a fix-claim. ` +
      `Of those, ${withClaimAndUpgrade} had at least one finding escalated; ${withClaimNoUpgrade} did not.\n`,
  );
  process.stdout.write(
    withClaimNoUpgrade === 0
      ? '\nResult: every fix-claim broken entry saw at least one escalation.\n'
      : `\nResult: ${withClaimNoUpgrade} fix-claim broken entries had no finding for the layer to escalate; the upstream detector did not fire on them at all.\n`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`verify-pr-intent: ${(err as Error).message}\n`);
    process.exitCode = 1;
  });
}
