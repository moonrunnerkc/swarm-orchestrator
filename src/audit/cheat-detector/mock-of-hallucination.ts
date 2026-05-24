// Mock-of-hallucination: PR adds a mock for a module that does not exist
// as a real dependency in any manifest. Telltale that an agent invented
// the integration and mocked it to make a test pass.
//
// v1.1.0: manifest readers extracted to `./manifests/`; five new
// ecosystems supported (Maven, Gradle, Gemfile, composer.json,
// *.csproj). Mock-pattern matchers added for Java/Kotlin (Mockito,
// @MockBean), Ruby (allow_any_instance_of, RSpec mocks), PHP
// (PHPUnit createMock / getMockBuilder), and C# (Moq, NSubstitute).
// `collectKnownDependencies` from `./manifests/` is the single source
// of truth: adding an ecosystem is a new reader file plus one line in
// `manifests/index.ts`.

import type { Detector, DetectorContext } from './detector-types';
import type { Finding } from '../types';
import { isCommentOnlyLine, walkHunks } from './diff-walker';
import { collectKnownDependencies } from './manifests';

const VERSION = '1.1.0';

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

const GO_MOCK_PATTERNS: RegExp[] = [/mock\.Register\(\s*"([^"]+)"/];

// Java/Kotlin mocks. Mockito.mock takes a Class<?> arg, not a string;
// we extract the bare class name and check it against the
// artifactId vocabulary the Maven/Gradle readers expose. @MockBean
// from Spring Test follows the same convention.
const JVM_MOCK_PATTERNS: RegExp[] = [
  /Mockito\.mock\(\s*([A-Za-z0-9_.]+)\.class/,
  /@MockBean[^a-zA-Z]+([A-Za-z0-9_]+)/,
  /mockk<\s*([A-Za-z0-9_.]+)\s*>/,
];

// Ruby mocks. allow_any_instance_of, instance_double, class_double.
const RUBY_MOCK_PATTERNS: RegExp[] = [
  /allow_any_instance_of\(\s*([A-Za-z0-9_:]+)\s*\)/,
  /instance_double\(\s*['"]?([A-Za-z0-9_:]+)['"]?/,
  /class_double\(\s*['"]?([A-Za-z0-9_:]+)['"]?/,
];

// PHP mocks: PHPUnit's createMock / getMockBuilder take a class name.
const PHP_MOCK_PATTERNS: RegExp[] = [
  /\$this->createMock\(\s*([A-Za-z0-9_\\]+)::class\s*\)/,
  /\$this->getMockBuilder\(\s*([A-Za-z0-9_\\]+)::class\s*\)/,
];

// C# mocks: Moq's `new Mock<IFoo>()` and NSubstitute's `Substitute.For<IFoo>()`.
const CSHARP_MOCK_PATTERNS: RegExp[] = [
  /new\s+Mock<\s*([A-Za-z0-9_.]+)\s*>/,
  /Substitute\.For<\s*([A-Za-z0-9_.]+)\s*>/,
];

const ALL_PATTERNS: readonly RegExp[] = [
  ...JS_MOCK_PATTERNS,
  ...PY_MOCK_PATTERNS,
  ...GO_MOCK_PATTERNS,
  ...JVM_MOCK_PATTERNS,
  ...RUBY_MOCK_PATTERNS,
  ...PHP_MOCK_PATTERNS,
  ...CSHARP_MOCK_PATTERNS,
];

export const mockOfHallucinationDetector: Detector = {
  name: 'mock-of-hallucination',
  version: VERSION,
  run(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const knownDeps = collectKnownDependencies(ctx.repoRoot);
    const knownLower = lowerSet(knownDeps);
    const hunks = walkHunks(ctx.files);
    for (const hunk of hunks) {
      for (const addition of hunk.added) {
        if (isCommentOnlyLine(addition.content)) continue;
        const claimed = extractMockTarget(addition.content);
        if (claimed === undefined) continue;
        if (isLocalImport(claimed)) continue;
        if (resolvesAgainst(claimed, knownDeps, knownLower)) continue;
        findings.push({
          category: 'mock-of-hallucination',
          severity: 'block',
          message:
            `Mocked module "${claimed}" is not declared in any project manifest ` +
            `(package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml, ` +
            `pom.xml, build.gradle[.kts], Gemfile[.lock], composer.json, *.csproj). ` +
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
  for (const re of ALL_PATTERNS) {
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
  // Python attribute paths / Java dotted paths / Ruby module paths.
  if (target.includes('.') && !target.includes('/')) {
    return target.split('.')[0] ?? target;
  }
  if (target.includes('::')) {
    return target.split('::')[0] ?? target;
  }
  if (target.includes('\\')) {
    return target.split('\\')[0] ?? target;
  }
  const slash = target.indexOf('/');
  return slash === -1 ? target : target.slice(0, slash);
}

function lastSegmentOf(target: string): string {
  const segs = target.split(/[./\\:]/).filter((s) => s.length > 0);
  return segs[segs.length - 1] ?? target;
}

/**
 * True iff `claimed` resolves against any declared dependency under
 * the various conventions in use across the supported ecosystems:
 *   1. exact match (`@octokit/rest`)
 *   2. top-level package (the first segment of an attribute path)
 *   3. last segment (a bare class name pulled out of a dotted path)
 *   4. any dotted prefix walked from the start, so a Newtonsoft.Json
 *      manifest entry resolves a Newtonsoft.Json.JsonConvert mock
 *   5. case-insensitive variant of any of the above (Ruby modules
 *      are CamelCase but gem names are lowercase; the JVM groupId
 *      convention is lowercase but Java packages can vary)
 */
function resolvesAgainst(
  claimed: string,
  known: Set<string>,
  knownLower: Set<string>,
): boolean {
  const candidates = new Set<string>();
  candidates.add(claimed);
  const root = topLevelPackageOf(claimed);
  if (root.length > 0) candidates.add(root);
  candidates.add(lastSegmentOf(claimed));
  for (const prefix of dottedPrefixes(claimed)) candidates.add(prefix);
  for (const cand of candidates) {
    if (known.has(cand)) return true;
    if (knownLower.has(cand.toLowerCase())) return true;
  }
  return false;
}

function dottedPrefixes(target: string): string[] {
  const segs = target.split('.');
  if (segs.length <= 1) return [];
  const out: string[] = [];
  for (let i = 2; i <= segs.length; i += 1) {
    out.push(segs.slice(0, i).join('.'));
  }
  return out;
}

function lowerSet(values: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const v of values) out.add(v.toLowerCase());
  return out;
}
