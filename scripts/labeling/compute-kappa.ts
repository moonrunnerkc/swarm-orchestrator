// Compute Cohen's kappa pairwise across the labels-v2 rater files
// and emit `benchmarks/real-corpus/labels-v2/agreement.json`.
//
// Kappa is computed on the binary projection `verdict === 'broken'`
// (clean and ambiguous both collapse to "not broken"). This matches
// the rubric in docs/labeling-methodology.md: the gate is the binary
// decision the scorer cares about, even though raters can mark
// ambiguous. The two-axis kappa (broken vs. clean vs. ambiguous)
// would inflate the agreement on the very PRs the dispute path is
// supposed to catch.
//
// Usage:
//
//   node dist/scripts/labeling/compute-kappa.js
//     [--labels-dir benchmarks/real-corpus/labels-v2]
//     [--threshold 0.6]
//     [--out benchmarks/real-corpus/labels-v2/agreement.json]

import * as fs from 'fs';
import * as path from 'path';

interface LabelEntry {
  id: string;
  raterId: string;
  verdict: 'clean' | 'broken' | 'ambiguous';
}

interface PairKappa {
  raterA: string;
  raterB: string;
  comparisons: number;
  agreements: number;
  observedAgreement: number;
  expectedAgreement: number;
  kappa: number | null;
}

interface AgreementOutput {
  generatedAt: string;
  computedBy: string;
  ratersIncluded: string[];
  pairs: PairKappa[];
  minimumKappa: number | null;
  passesGate: boolean | null;
  kappaThreshold: number;
  totalEntriesByRater: Record<string, number>;
}

function parseArgs(argv: string[]): {
  labelsDir: string;
  threshold: number;
  out: string;
} {
  let labelsDir = path.join('benchmarks', 'real-corpus', 'labels-v2');
  let threshold = 0.6;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--labels-dir' && argv[i + 1] !== undefined) {
      labelsDir = argv[i + 1]!;
      i += 1;
    } else if (arg === '--threshold' && argv[i + 1] !== undefined) {
      threshold = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--out' && argv[i + 1] !== undefined) {
      out = argv[i + 1]!;
      i += 1;
    }
  }
  return {
    labelsDir,
    threshold,
    out: out ?? path.join(labelsDir, 'agreement.json'),
  };
}

function loadRaterFile(file: string): LabelEntry[] {
  const text = fs.readFileSync(file, 'utf8');
  const out: LabelEntry[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const obj = JSON.parse(line) as LabelEntry;
    out.push(obj);
  }
  return out;
}

function discoverRaters(labelsDir: string): { raterId: string; entries: LabelEntry[] }[] {
  if (!fs.existsSync(labelsDir)) return [];
  const out: { raterId: string; entries: LabelEntry[] }[] = [];
  for (const name of fs.readdirSync(labelsDir)) {
    if (!/^rater-\d+/.test(name)) continue;
    const file = path.join(labelsDir, name, 'labels.jsonl');
    if (!fs.existsSync(file)) continue;
    const entries = loadRaterFile(file);
    if (entries.length === 0) continue;
    out.push({ raterId: name, entries });
  }
  out.sort((a, b) => a.raterId.localeCompare(b.raterId));
  return out;
}

/**
 * Cohen's kappa for two raters on a binary projection.
 *
 *   po = observed agreement
 *   pe = expected agreement by chance, given each rater's marginals
 *   kappa = (po - pe) / (1 - pe)
 *
 * Returns null when `pe === 1` (both raters labeled every shared PR
 * the same one direction); kappa is undefined in that limit.
 */
export function computePairKappa(
  a: ReadonlyMap<string, boolean>,
  b: ReadonlyMap<string, boolean>,
): { comparisons: number; agreements: number; po: number; pe: number; kappa: number | null } {
  const sharedIds = [...a.keys()].filter((id) => b.has(id));
  const n = sharedIds.length;
  if (n === 0) {
    return { comparisons: 0, agreements: 0, po: 0, pe: 0, kappa: null };
  }
  let bothTrue = 0;
  let bothFalse = 0;
  let aTrue = 0;
  let bTrue = 0;
  for (const id of sharedIds) {
    const va = a.get(id) === true;
    const vb = b.get(id) === true;
    if (va) aTrue += 1;
    if (vb) bTrue += 1;
    if (va === vb) {
      if (va) bothTrue += 1;
      else bothFalse += 1;
    }
  }
  const agreements = bothTrue + bothFalse;
  const po = agreements / n;
  const pe = (aTrue / n) * (bTrue / n) + ((n - aTrue) / n) * ((n - bTrue) / n);
  const kappa = pe === 1 ? null : (po - pe) / (1 - pe);
  return { comparisons: n, agreements, po, pe, kappa };
}

export function compute(args: { labelsDir: string; threshold: number }): AgreementOutput {
  const raters = discoverRaters(args.labelsDir);
  const pairs: PairKappa[] = [];
  let minKappa: number | null = null;
  for (let i = 0; i < raters.length; i += 1) {
    for (let j = i + 1; j < raters.length; j += 1) {
      const a = raters[i]!;
      const b = raters[j]!;
      const mapA = projectBroken(a.entries);
      const mapB = projectBroken(b.entries);
      const k = computePairKappa(mapA, mapB);
      pairs.push({
        raterA: a.raterId,
        raterB: b.raterId,
        comparisons: k.comparisons,
        agreements: k.agreements,
        observedAgreement: k.po,
        expectedAgreement: k.pe,
        kappa: k.kappa,
      });
      if (k.kappa !== null) {
        minKappa = minKappa === null ? k.kappa : Math.min(minKappa, k.kappa);
      }
    }
  }
  const passesGate = minKappa === null ? null : minKappa >= args.threshold;
  const totalsByRater: Record<string, number> = {};
  for (const r of raters) totalsByRater[r.raterId] = r.entries.length;
  return {
    generatedAt: new Date().toISOString(),
    computedBy: 'scripts/labeling/compute-kappa.ts',
    ratersIncluded: raters.map((r) => r.raterId),
    pairs,
    minimumKappa: minKappa,
    passesGate,
    kappaThreshold: args.threshold,
    totalEntriesByRater: totalsByRater,
  };
}

function projectBroken(entries: readonly LabelEntry[]): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const e of entries) m.set(e.id, e.verdict === 'broken');
  return m;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const out = compute(args);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(out, null, 2) + '\n');
  // eslint-disable-next-line no-console
  console.log(
    `compute-kappa: raters=${out.ratersIncluded.length} pairs=${out.pairs.length} ` +
      `min-kappa=${out.minimumKappa ?? 'n/a'} passes-gate=${out.passesGate ?? 'n/a'} ` +
      `out=${args.out}`,
  );
  if (out.passesGate === false) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(2);
  });
}
