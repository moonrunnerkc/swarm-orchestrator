// Python interpreter resolution for the execution-grounded sandbox.
//
// A Python project declares the interpreter range it supports, and installing it
// under an out-of-range interpreter fails at metadata resolution with a message
// about the interpreter rather than about the project. Using whatever `python3`
// the host happens to expose therefore turns a perfectly installable repo into a
// provision failure whose recorded reason describes the auditor's machine. This
// module reads the declared range and picks the newest installed interpreter
// inside it, so the recorded outcome is about the repo.
//
// The parsing is deliberately small: PEP 440 comparison clauses as they appear in
// `requires-python`, plus poetry's caret and tilde shorthands. Anything it cannot
// parse is treated as "no constraint", which degrades to the previous behavior
// rather than inventing a restriction.

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { getLogger } from '../../logger';

const log = getLogger('audit:execution-grounded:python-interpreter');

/** Interpreters probed, newest first. The bare `python3` is the final fallback. */
const CANDIDATE_INTERPRETERS: readonly string[] = [
  'python3.14',
  'python3.13',
  'python3.12',
  'python3.11',
  'python3.10',
  'python3.9',
  'python3',
];

/** A resolved interpreter: the binary to invoke and the version it reports. */
export interface ResolvedInterpreter {
  readonly bin: string;
  readonly version: string;
  /** The declared range it satisfies, or null when the project declared none. */
  readonly declaredRange: string | null;
}

/** Why no interpreter could be chosen. */
export interface InterpreterResolutionFailure {
  readonly declaredRange: string;
  readonly available: readonly string[];
  readonly detail: string;
}

/** A parsed comparison clause, e.g. `>=` `3.11`. */
interface Clause {
  readonly op: string;
  readonly parts: readonly number[];
}

/** Numeric release segments of a version string; trailing pre-release tags are
 *  dropped because a range clause never keys on them here. */
function versionParts(version: string): number[] {
  const m = /(\d+(?:\.\d+)*)/.exec(version);
  if (m === null) return [];
  return m[1]!.split('.').map((n) => Number.parseInt(n, 10));
}

/** Compare two release tuples, padding the shorter with zeros. */
function compare(a: readonly number[], b: readonly number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Expand poetry's `^X.Y` / `~X.Y` shorthands into explicit bounds. */
function expandShorthand(spec: string): string {
  const caret = /^\^(\d+)\.(\d+)(?:\.\d+)?$/.exec(spec);
  if (caret !== null) {
    return `>=${caret[1]}.${caret[2]},<${Number.parseInt(caret[1]!, 10) + 1}.0`;
  }
  const tilde = /^~(\d+)\.(\d+)(?:\.\d+)?$/.exec(spec);
  if (tilde !== null) {
    return `>=${tilde[1]}.${tilde[2]},<${tilde[1]}.${Number.parseInt(tilde[2]!, 10) + 1}`;
  }
  return spec;
}

/** Parse a comma-separated range into comparison clauses, dropping any clause
 *  whose operator this module does not implement. */
function parseRange(spec: string): Clause[] {
  const clauses: Clause[] = [];
  for (const raw of spec.split(',')) {
    const piece = expandShorthand(raw.trim());
    for (const part of piece.split(',')) {
      const m = /^(>=|<=|==|!=|~=|>|<)\s*([0-9][0-9.]*)/.exec(part.trim());
      if (m === null) continue;
      clauses.push({ op: m[1]!, parts: versionParts(m[2]!) });
    }
  }
  return clauses;
}

/**
 * Whether `version` satisfies every clause of `spec`.
 *
 * @param version an interpreter version such as `3.12.4`.
 * @param spec a declared range such as `>=3.11,<3.13`.
 * @returns true when the version satisfies the range, or the range parsed to no
 *   usable clause (an unparseable declaration must not exclude everything).
 */
export function satisfiesRange(version: string, spec: string): boolean {
  const clauses = parseRange(spec);
  if (clauses.length === 0) return true;
  const v = versionParts(version);
  return clauses.every((c) => {
    const cmp = compare(v, c.parts);
    switch (c.op) {
      case '>=':
        return cmp >= 0;
      case '>':
        return cmp > 0;
      case '<=':
        return cmp <= 0;
      case '<':
        return cmp < 0;
      case '==':
        return cmp === 0;
      case '!=':
        return cmp !== 0;
      case '~=': {
        // Compatible release: >= the clause, and < the next release of its
        // second-to-last segment.
        if (cmp < 0) return false;
        const upper = c.parts.slice(0, -1);
        if (upper.length === 0) return true;
        upper[upper.length - 1] = (upper[upper.length - 1] ?? 0) + 1;
        return compare(v, upper) < 0;
      }
      default:
        return true;
    }
  });
}

/**
 * Read the interpreter range a Python project declares.
 *
 * @param dir the project root (absolute).
 * @returns the declared range, or null when the project declares none.
 */
export function readDeclaredPythonRange(dir: string): string | null {
  const pyproject = path.join(dir, 'pyproject.toml');
  if (fs.existsSync(pyproject)) {
    let text = '';
    try {
      text = fs.readFileSync(pyproject, 'utf8');
    } catch (err) {
      log.debug(`unreadable pyproject.toml at ${pyproject}: ${String(err)}`);
    }
    const pep621 = /^\s*requires-python\s*=\s*["']([^"']+)["']/m.exec(text);
    if (pep621 !== null) return pep621[1]!.trim();
    const poetry = /^\s*python\s*=\s*["']([^"']+)["']/m.exec(text);
    if (poetry !== null) return poetry[1]!.trim();
  }
  const setupCfg = path.join(dir, 'setup.cfg');
  if (fs.existsSync(setupCfg)) {
    try {
      const m = /^\s*python_requires\s*=\s*(.+)$/m.exec(fs.readFileSync(setupCfg, 'utf8'));
      if (m !== null) return m[1]!.trim();
    } catch (err) {
      log.debug(`unreadable setup.cfg at ${setupCfg}: ${String(err)}`);
    }
  }
  return null;
}

/** `<bin> --version` reported by a candidate on PATH, or null when absent. */
function probeVersion(bin: string, env: NodeJS.ProcessEnv): string | null {
  const res = spawnSync(bin, ['--version'], { encoding: 'utf8', env, timeout: 30_000 });
  if (res.status !== 0) return null;
  const text = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const m = /Python\s+(\d[\d.]*)/.exec(text);
  return m !== null ? m[1]! : null;
}

/**
 * Every interpreter this environment can run, newest candidate first.
 *
 * @param env the environment whose PATH is searched.
 * @returns one entry per resolvable candidate, deduplicated by version.
 */
export function discoverInterpreters(
  env: NodeJS.ProcessEnv,
): Array<{ bin: string; version: string }> {
  const found: Array<{ bin: string; version: string }> = [];
  const seen = new Set<string>();
  for (const bin of CANDIDATE_INTERPRETERS) {
    const version = probeVersion(bin, env);
    if (version === null || seen.has(version)) continue;
    seen.add(version);
    found.push({ bin, version });
  }
  return found;
}

/**
 * Choose the interpreter a project's venv should be built with: the newest
 * installed one inside the declared range.
 *
 * @param dir the project root (absolute).
 * @param env the environment the install will run under.
 * @returns the resolved interpreter, or a failure naming the declared range and
 *   what was actually available so the record blames the right thing.
 */
export function resolvePythonInterpreter(
  dir: string,
  env: NodeJS.ProcessEnv,
): { ok: true; interpreter: ResolvedInterpreter } | { ok: false; failure: InterpreterResolutionFailure } {
  const declaredRange = readDeclaredPythonRange(dir);
  const available = discoverInterpreters(env);
  if (available.length === 0) {
    return {
      ok: false,
      failure: {
        declaredRange: declaredRange ?? 'none declared',
        available: [],
        detail: 'no python3 interpreter is resolvable on the sandbox PATH',
      },
    };
  }
  if (declaredRange === null) {
    // No declaration: keep the historical choice so behavior is unchanged for
    // every project that never constrained its interpreter.
    const fallback = available.find((i) => i.bin === 'python3') ?? available[0]!;
    return {
      ok: true,
      interpreter: { bin: fallback.bin, version: fallback.version, declaredRange: null },
    };
  }
  const sorted = [...available].sort((a, b) => compare(versionParts(b.version), versionParts(a.version)));
  const match = sorted.find((i) => satisfiesRange(i.version, declaredRange));
  if (match === undefined) {
    return {
      ok: false,
      failure: {
        declaredRange,
        available: available.map((i) => i.version),
        detail:
          `the project requires Python '${declaredRange}' and no installed interpreter satisfies it ` +
          `(available: ${available.map((i) => i.version).join(', ')})`,
      },
    };
  }
  log.info(
    `python interpreter ${match.bin} (${match.version}) satisfies the declared range '${declaredRange}'`,
  );
  return { ok: true, interpreter: { bin: match.bin, version: match.version, declaredRange } };
}
