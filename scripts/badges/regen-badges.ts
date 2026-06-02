// Regenerate the README badges row from the committed evidence so the
// badges never drift from the numbers they cite. Reads the version from
// package.json, the oracle recall from the A/B report, and the real-PR
// false-alarm burden from the real-world report, and rewrites the block
// between the <!-- BADGES:START --> and <!-- BADGES:END --> markers in
// README.md (inserting the markers around the existing badge block if they
// are not present yet).
//
// Usage:
//   node dist/scripts/badges/regen-badges.js          # rewrite README
//   node dist/scripts/badges/regen-badges.js --check   # exit 1 if it would change

import * as fs from 'fs';
import * as path from 'path';

const START = '<!-- BADGES:START -->';
const END = '<!-- BADGES:END -->';

function root(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

function read(rel: string): string {
  return fs.readFileSync(path.join(root(), rel), 'utf8');
}

function shield(label: string, message: string, color: string, href: string): string {
  // The static/v1 query form takes standard URL-encoded label/message, so
  // spaces, parens, and slashes are unambiguous (the path form's
  // dash/underscore escaping is error-prone).
  const url =
    `https://img.shields.io/static/v1?label=${encodeURIComponent(label)}` +
    `&message=${encodeURIComponent(message)}&color=${color}`;
  return `[![${label} ${message}](${url})](${href})`;
}

/** Oracle recall as caught/total from the A/B report's "253/300 vs" phrase. */
function oracleRecall(): { caught: number; total: number } | null {
  const m = read('benchmarks/results/AB-REPORT.md').match(/(\d+)\/(\d+)\s+vs/);
  if (m === null || m[1] === undefined || m[2] === undefined) return null;
  return { caught: Number(m[1]), total: Number(m[2]) };
}

/** Real-PR false-alarm burden per PR from the real-world report headline. */
function realPrBurden(): number | null {
  const file = path.join(root(), 'benchmarks', 'real-prs', 'REAL-WORLD-REPORT.md');
  if (!fs.existsSync(file)) return null;
  const m = fs.readFileSync(file, 'utf8').match(/false-alarm burden of \*\*([\d.]+)\/PR\*\*/);
  return m && m[1] !== undefined ? Number(m[1]) : null;
}

/** The honest real-PR numbers from the v11 benefit report: how many cheats
 *  two independent arbiters confirmed that the linters missed, and the
 *  external-tool finding count on the bad PRs (the empty set the auditor is
 *  measured against). Cites the real, non-overclaiming result. */
function benefitHeadline(): { confirmedCheats: number; externalOnBad: number } | null {
  const file = path.join(root(), 'benchmarks', 'real-prs', 'v11-BENEFIT-REPORT.md');
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const confirmed = text.match(/The (\d+) confirmed true-cheats both models/);
  const external = text.match(/raised essentially nothing on the bad PRs \((\d+) findings? across all/);
  if (confirmed === null || confirmed[1] === undefined) return null;
  return {
    confirmedCheats: Number(confirmed[1]),
    externalOnBad: external && external[1] !== undefined ? Number(external[1]) : 0,
  };
}

function buildBadges(): string {
  const version = (JSON.parse(read('package.json')) as { version: string }).version;
  // The CI badge is GitHub's live workflow badge, not a shields.io static
  // one, so it is a literal line rather than a generated shield.
  const ci =
    '[![CI](https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml/badge.svg?branch=main)]' +
    '(https://github.com/moonrunnerkc/swarm-orchestrator/actions/workflows/ci.yml)';
  const lines: string[] = [
    ci,
    shield('license', 'ISC', 'blue', 'LICENSE'),
    shield('node', '>= 20', '3c873a', 'package.json'),
    shield('version', version, '22d3ee', 'package.json'),
  ];
  const recall = oracleRecall();
  if (recall !== null) {
    const pct = Math.round((recall.caught / recall.total) * 100);
    lines.push(
      shield(
        'oracle recall',
        `${pct}% (${recall.caught}/${recall.total})`,
        'brightgreen',
        'benchmarks/results/AB-REPORT.md',
      ),
    );
  }
  const burden = realPrBurden();
  if (burden !== null) {
    lines.push(
      shield(
        'real-PR false alarms',
        `${burden.toFixed(2)}/PR`,
        burden <= 0.2 ? 'brightgreen' : 'orange',
        'benchmarks/real-prs/REAL-WORLD-REPORT.md',
      ),
    );
  }
  const benefit = benefitHeadline();
  if (benefit !== null) {
    lines.push(
      shield(
        'real-PR cheats vs linters',
        `${benefit.confirmedCheats} confirmed (Semgrep+ESLint: ${benefit.externalOnBad})`,
        benefit.confirmedCheats > 0 ? 'brightgreen' : 'lightgrey',
        'benchmarks/real-prs/v11-BENEFIT-REPORT.md',
      ),
    );
  }
  return lines.join('\n');
}

// Replace the marker block, or insert markers around the first contiguous
// run of badge lines (lines starting with `[![`) if the markers are absent.
function rewriteReadme(readme: string, block: string): string {
  const wrapped = `${START}\n${block}\n${END}`;
  if (readme.includes(START) && readme.includes(END)) {
    return readme.replace(new RegExp(`${START}[\\s\\S]*?${END}`), wrapped);
  }
  const lines = readme.split('\n');
  let first = -1;
  let last = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]!.startsWith('[![')) {
      if (first === -1) first = i;
      last = i;
    } else if (first !== -1 && lines[i]!.trim().length === 0 && last === i - 1) {
      // allow a single trailing run; stop at the first gap after the run
      break;
    } else if (first !== -1 && last < i - 1) {
      break;
    }
  }
  if (first === -1) {
    throw new Error('no badge lines (starting with [![) found in README and no markers present');
  }
  const before = lines.slice(0, first).join('\n');
  const after = lines.slice(last + 1).join('\n');
  return `${before}\n${wrapped}\n${after}`;
}

function main(): void {
  const check = process.argv.includes('--check');
  const readmePath = path.join(root(), 'README.md');
  const current = fs.readFileSync(readmePath, 'utf8');
  const next = rewriteReadme(current, buildBadges());
  if (check) {
    if (next !== current) {
      process.stderr.write(
        'badges:check: README badges are stale. Run `npm run badges:regen` and commit.\n',
      );
      process.exit(1);
    }
    process.stdout.write('badges:check: README badges are up to date.\n');
    return;
  }
  fs.writeFileSync(readmePath, next);
  process.stdout.write('badges:regen: rewrote the README badges row.\n');
}

main();
