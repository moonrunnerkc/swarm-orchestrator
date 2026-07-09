// CI ratchet: no gate trigger may fire on a false-positive registry entry. For
// every `neutralized-by-refuter` entry the named refuter must still fire on the
// committed diff (so the gate's proof downgrades rather than blocks). If it no
// longer fires, the diagnosed FP class has regressed: exit non-zero and CI goes
// red. Run: npm run fp-registry:check.

import { loadRegistry, loadEntryDiff, evaluateEntry, DEFAULT_FP_REGISTRY_DIR } from './fp-registry';

function parseDir(argv: string[]): string {
  const i = argv.indexOf('--dir');
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : DEFAULT_FP_REGISTRY_DIR;
}

function main(): void {
  const dir = parseDir(process.argv.slice(2));
  const entries = loadRegistry(dir);
  if (entries.length === 0) {
    process.stdout.write('check-fp-registry: registry is empty; nothing to enforce\n');
    return;
  }
  const failures: string[] = [];
  for (const entry of entries) {
    if (entry.disposition !== 'neutralized-by-refuter') {
      process.stdout.write(`check-fp-registry: ${entry.id} [${entry.disposition}] (not refuter-gated)\n`);
      continue;
    }
    const evaluation = evaluateEntry(entry, loadEntryDiff(entry, dir));
    process.stdout.write(
      `check-fp-registry: ${entry.id} -> ${evaluation.neutralized ? 'NEUTRALIZED' : 'REGRESSED'} ` +
        `(${evaluation.detail})\n`,
    );
    if (!evaluation.neutralized) {
      failures.push(`${entry.id} (${entry.pr}): ${evaluation.detail}`);
    }
  }
  if (failures.length > 0) {
    process.stderr.write(
      `check-fp-registry: ${failures.length} registry entry(ies) would fire the gate again:\n` +
        failures.map((f) => `  - ${f}`).join('\n') +
        '\nA diagnosed false-positive class has regressed. Restore the refuter that neutralized it.\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `check-fp-registry: all ${entries.length} entry(ies) remain neutralized; no gate trigger fires\n`,
  );
}

if (require.main === module) {
  main();
}
