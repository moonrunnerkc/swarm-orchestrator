// Mock-of-hallucination: PR adds a mock for a module that does not exist
// as a real dependency in any manifest (package.json, requirements.txt,
// pyproject.toml, go.mod, Cargo.toml). Telltale that an agent invented
// the integration and mocked it to make a test pass.
//
// The detector looks at *added* lines in the diff (the mock setup) and
// resolves declared imports/mocks against the head-revision manifest
// content reachable from `ctx.repoRoot`. We don't `npm install`; we read
// the manifest text from disk because the audit job runs in checkout
// CI, where the manifest is already on disk at the PR head.

import * as fs from 'fs';
import * as path from 'path';
import type { Detector, DetectorContext } from './detector-types';
import type { Finding } from '../types';
import { isCommentOnlyLine, walkHunks } from './diff-walker';

const VERSION = '1.0.0';

const JS_MOCK_PATTERNS: RegExp[] = [
  /jest\.mock\(\s*['"]([^'"]+)['"]/,
  /vi\.mock\(\s*['"]([^'"]+)['"]/,
  /sinon\.mock\(\s*['"]([^'"]+)['"]/,
];

const PY_MOCK_PATTERNS: RegExp[] = [
  /@patch\(\s*['"]([^'"]+)['"]/,
  /mock\.patch\(\s*['"]([^'"]+)['"]/,
  /patch\(\s*['"]([^'"]+)['"]/,
];

const GO_MOCK_PATTERNS: RegExp[] = [
  /mock\.Register\(\s*"([^"]+)"/,
];

export const mockOfHallucinationDetector: Detector = {
  name: 'mock-of-hallucination',
  version: VERSION,
  run(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const knownDeps = collectKnownDependencies(ctx.repoRoot);
    const hunks = walkHunks(ctx.files);
    for (const hunk of hunks) {
      for (const addition of hunk.added) {
        if (isCommentOnlyLine(addition.content)) continue;
        const claimed = extractMockTarget(addition.content);
        if (claimed === undefined) continue;
        if (isLocalImport(claimed)) continue;
        const root = topLevelPackageOf(claimed);
        if (knownDeps.has(root)) continue;
        if (root.length === 0) continue;
        findings.push({
          category: 'mock-of-hallucination',
          severity: 'block',
          message:
            `Mocked module "${claimed}" is not declared in any project manifest ` +
            `(package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml). ` +
            `Mocking a nonexistent dependency typically means the agent fabricated ` +
            `the integration to satisfy a test.`,
          location: { file: hunk.file, line: addition.lineNumber },
          evidence: `+ ${addition.content.trim()}`,
        });
      }
    }
    return findings;
  },
};

function extractMockTarget(line: string): string | undefined {
  for (const re of [...JS_MOCK_PATTERNS, ...PY_MOCK_PATTERNS, ...GO_MOCK_PATTERNS]) {
    const m = line.match(re);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

function isLocalImport(target: string): boolean {
  return target.startsWith('.') || target.startsWith('/') || target.startsWith('~');
}

function topLevelPackageOf(target: string): string {
  if (target.startsWith('@')) {
    const slash = target.indexOf('/');
    const second = target.indexOf('/', slash + 1);
    return second === -1 ? target : target.slice(0, second);
  }
  // Python attribute paths: "mypkg.submod.thing" → "mypkg".
  if (target.includes('.') && !target.includes('/')) {
    return target.split('.')[0] ?? target;
  }
  const slash = target.indexOf('/');
  return slash === -1 ? target : target.slice(0, slash);
}

function collectKnownDependencies(repoRoot: string): Set<string> {
  const out = new Set<string>();
  readPackageJson(repoRoot, out);
  readRequirementsTxt(repoRoot, out);
  readPyprojectToml(repoRoot, out);
  readGoMod(repoRoot, out);
  readCargoToml(repoRoot, out);
  return out;
}

function readPackageJson(repoRoot: string, out: Set<string>): void {
  const file = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(file)) return;
  const parsed = parseJsonOrEmpty(fs.readFileSync(file, 'utf8'));
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const block = parsed[key];
    if (block !== null && typeof block === 'object') {
      for (const name of Object.keys(block as Record<string, unknown>)) {
        out.add(name);
      }
    }
  }
}

function readRequirementsTxt(repoRoot: string, out: Set<string>): void {
  const file = path.join(repoRoot, 'requirements.txt');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const name = line.split(/[<>=!~ ]/)[0]?.trim();
    if (name !== undefined && name.length > 0) out.add(name);
  }
}

function readPyprojectToml(repoRoot: string, out: Set<string>): void {
  const file = path.join(repoRoot, 'pyproject.toml');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  // Minimal TOML walk for dependency tables. We do not introduce a TOML
  // parser dep; the canonical PEP 621 and Poetry layouts are line-greppable.
  const depRe = /^([A-Za-z0-9_\-.]+)\s*=/gm;
  let inDepBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inDepBlock =
        line.includes('dependencies') ||
        line === '[tool.poetry.dependencies]' ||
        line === '[tool.poetry.dev-dependencies]' ||
        line === '[project.optional-dependencies]';
      continue;
    }
    if (!inDepBlock) continue;
    const m = depRe.exec(line);
    if (m?.[1] !== undefined && m[1].toLowerCase() !== 'python') out.add(m[1]);
    depRe.lastIndex = 0;
    // PEP 621 array form: `dependencies = ["foo>=1", "bar"]`
    const arrayMatch = line.match(/^dependencies\s*=\s*\[(.+)\]$/);
    if (arrayMatch?.[1]) {
      for (const item of arrayMatch[1].split(',')) {
        const name = item.replace(/['"]/g, '').split(/[<>=!~ ]/)[0]?.trim();
        if (name !== undefined && name.length > 0) out.add(name);
      }
    }
  }
}

function readGoMod(repoRoot: string, out: Set<string>): void {
  const file = path.join(repoRoot, 'go.mod');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^require\s+([A-Za-z0-9._\-/]+)\s+v?[\d.]/);
    if (m?.[1]) out.add(m[1]);
    const blockMatch = line.match(/^([A-Za-z0-9._\-/]+)\s+v?[\d.]/);
    if (blockMatch?.[1] && !line.startsWith('require') && !line.startsWith('module')) {
      out.add(blockMatch[1]);
    }
  }
}

function readCargoToml(repoRoot: string, out: Set<string>): void {
  const file = path.join(repoRoot, 'Cargo.toml');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  let inDepBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inDepBlock = line === '[dependencies]' || line === '[dev-dependencies]';
      continue;
    }
    if (!inDepBlock) continue;
    const m = line.match(/^([A-Za-z0-9_\-]+)\s*=/);
    if (m?.[1]) out.add(m[1]);
  }
}

function parseJsonOrEmpty(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch (err) {
    throw new Error(
      `mock-of-hallucination: failed to parse package.json: ${(err as Error).message}`,
      { cause: err },
    );
  }
}
