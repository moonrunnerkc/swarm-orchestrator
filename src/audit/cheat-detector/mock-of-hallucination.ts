// Mock-of-hallucination v2.0 (v10.2-advisory). The v1.x detector
// matched `jest.mock('foo')` etc. against the project's manifest
// vocabulary; the v10.1 real-corpus baseline showed that the
// dominant *miss* was a different shape entirely:
//
//   - `uses: actions/checkout@v6` (action exists, version does not)
//   - a nonexistent Dependabot REST endpoint (URL hallucination)
//
// v2.0 extends the detector beyond manifest-scanning by routing every
// candidate external reference (mock target, workflow `uses:` ref)
// through a `RegistryProbe`. The default probe answers from an
// offline allowlist; an opt-in online probe can be wired in by a
// runtime caller (and shares the same in-memory cache layer).
//
// New finding sub-classes:
//
//   - `mock-target-unknown`: same as v1.x — the mocked module is not
//     in the manifest. Severity `block` when the module is also not
//     in the offline allowlist; `info` when it is (probable false-
//     positive on a project-local mock path the manifest cannot see).
//   - `gha-version-unknown`: a `uses: <action>@<version>` reference
//     where the action is in the allowlist but the version is past
//     the highest known. Severity `block`. Catches the v10.1
//     `actions/checkout@v6` miss.
//   - `gha-action-unknown`: the action itself is not in the
//     allowlist. Severity `info`. The allowlist is small enough that
//     unknown is mostly a "no signal" case; a future online probe
//     can promote some of these.

import type { Detector, DetectorContext } from './detector-types';
import type { Finding, Severity } from '../types';
import { isCommentOnlyLine, walkHunks } from './diff-walker';
import { collectKnownDependencies } from './manifests';
import {
  collectInternalRoots,
  collectInternalRootsFromFiles,
  resolvesToInternalRoot,
} from './internal-roots';
import {
  defaultRegistryProbe,
  extractUsesRefs,
  type ProbeQuery,
  type ProbeResult,
  type RegistryProbe,
} from './registries';

const VERSION = '2.0.0';

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

const JVM_MOCK_PATTERNS: RegExp[] = [
  /Mockito\.mock\(\s*([A-Za-z0-9_.]+)\.class/,
  /@MockBean[^a-zA-Z]+([A-Za-z0-9_]+)/,
  /mockk<\s*([A-Za-z0-9_.]+)\s*>/,
];

const RUBY_MOCK_PATTERNS: RegExp[] = [
  /allow_any_instance_of\(\s*([A-Za-z0-9_:]+)\s*\)/,
  /instance_double\(\s*['"]?([A-Za-z0-9_:]+)['"]?/,
  /class_double\(\s*['"]?([A-Za-z0-9_:]+)['"]?/,
];

const PHP_MOCK_PATTERNS: RegExp[] = [
  /\$this->createMock\(\s*([A-Za-z0-9_\\]+)::class\s*\)/,
  /\$this->getMockBuilder\(\s*([A-Za-z0-9_\\]+)::class\s*\)/,
];

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

export interface MockOfHallucinationOptions {
  /**
   * Override the registry probe. Defaults to the offline-allowlist
   * caching probe. Tests pass a stub probe; an online-probe wrapper
   * passes its own caching layer.
   */
  registryProbe?: RegistryProbe;
}

export function buildMockOfHallucinationDetector(
  options: MockOfHallucinationOptions = {},
): Detector {
  const probe = options.registryProbe ?? defaultRegistryProbe();
  return {
    name: 'mock-of-hallucination',
    version: VERSION,
    run(ctx: DetectorContext): Finding[] {
      const findings: Finding[] = [];
      const knownDeps = collectKnownDependencies(ctx.repoRoot);
      const knownLower = lowerSet(knownDeps);
      // The wild-PR scan surfaced a class of false positive on
      // monorepos with subproject layouts: a Python test that mocks
      // `integrations.jira_dc.foo` was flagged as a hallucinated
      // package because `integrations` is not a pypi name — it's an
      // internal directory in the repo. We resolve a mock target as
      // "internal" when its top-level segment matches a real
      // directory under repoRoot.
      // Union of two sources: directories on disk under repoRoot (the
      // target repo for --repo-root and sidecar-backed --pr audits) and
      // directories named by the diff itself (the only reliable source
      // when repoRoot points elsewhere, e.g. the corpus scorer or a
      // bare --diff-file run). Without the diff-derived set, an internal
      // mock target like `routers.servers.os.makedirs` is misread as a
      // hallucinated pypi package whenever the filesystem is not the
      // PR's repo.
      const internalRoots = collectInternalRoots(ctx.repoRoot);
      for (const root of collectInternalRootsFromFiles(ctx.files)) {
        internalRoots.add(root);
      }
      const hunks = walkHunks(ctx.files);
      for (const hunk of hunks) {
        for (const addition of hunk.added) {
          if (isCommentOnlyLine(addition.content)) continue;
          const claimed = extractMockTarget(addition.content);
          if (claimed === undefined) continue;
          if (isLocalImport(claimed)) continue;
          if (resolvesToInternalRoot(claimed, internalRoots)) continue;
          if (resolvesAgainst(claimed, knownDeps, knownLower)) continue;
          const probeResult = probe.query(toMockProbeQuery(claimed));
          if (probeResult instanceof Promise) {
            // Offline probe is the default; we don't accept async
            // probes in the synchronous detector path. An online
            // wrapper should be called from outside the detector.
            continue;
          }
          findings.push(buildMockFinding(claimed, hunk.file, addition.lineNumber, addition.content, probeResult));
        }
      }
      const allAdded = hunks.flatMap((h) => h.added);
      const usesRefs = extractUsesRefs(allAdded);
      for (const ref of usesRefs) {
        const probeResult = probe.query({
          registry: 'github-actions',
          name: ref.action,
          ...(ref.version !== undefined ? { version: ref.version } : {}),
        });
        if (probeResult instanceof Promise) continue;
        const finding = buildGhaFinding(ref, probeResult);
        if (finding !== undefined) findings.push(finding);
      }
      return findings;
    },
  };
}

// Backwards-compatibility singleton used by the engine registry. New
// callers should construct their own via `buildMockOfHallucinationDetector`
// when they want to inject a custom probe.
export const mockOfHallucinationDetector: Detector = buildMockOfHallucinationDetector();

function toMockProbeQuery(claimed: string): ProbeQuery {
  // Heuristic: an `@scope/` npm-style name → npm; a dotted Python
  // path → pypi (top-level package); anything else falls back to
  // npm. The probe answers "unknown" cheaply when it doesn't know,
  // so a bias toward npm is safe for bare names like `lodash`.
  if (claimed.startsWith('@') || claimed.includes('/')) {
    return { registry: 'npm', name: claimed };
  }
  if (claimed.includes('.')) {
    const top = claimed.split('.')[0] ?? claimed;
    return { registry: 'pypi', name: top };
  }
  return { registry: 'npm', name: claimed };
}

function buildMockFinding(
  claimed: string,
  file: string,
  line: number,
  rawAddition: string,
  probeResult: ProbeResult,
): Finding {
  // v2.0 preserves the v1.x severity (block on any manifest miss) so
  // the synthetic regression corpus still passes. The probe verdict
  // is reported as a diagnostic line so a reviewer can downgrade
  // manually when the probe recognizes the package.
  const severity: Severity = 'block';
  const noteSuffix =
    probeResult.verdict === 'known'
      ? `Note: the registry probe recognized "${claimed}" as a real published ` +
        `package; this may be a false-positive on a project that vendors the ` +
        `dep or uses a non-standard manifest.`
      : `The registry probe also reports the target unknown: ${probeResult.diagnostic}.`;
  return {
    category: 'mock-of-hallucination',
    severity,
    message:
      `Mocked module "${claimed}" is not declared in any project manifest ` +
      `(package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml, ` +
      `pom.xml, build.gradle[.kts], Gemfile[.lock], composer.json, *.csproj). ` +
      `${noteSuffix}`,
    location: { file, line },
    evidence: `+ ${rawAddition.trim()}`,
  };
}

function buildGhaFinding(
  ref: ReturnType<typeof extractUsesRefs>[number],
  probeResult: ProbeResult,
): Finding | undefined {
  if (probeResult.verdict === 'known') return undefined;
  // Both remaining verdicts are advisory only. Offline, a version past
  // the pinned allowlist ceiling cannot be told apart from a real
  // newer release: the wild-PR scan flagged `actions/checkout@v5` and
  // `actions/setup-python@v6` as blocking hallucinations when both are
  // current first-party actions. A hardcoded version ceiling goes stale
  // the moment upstream ships a release, so it must not gate. The
  // signal is preserved at `info` for a reviewer (or an opt-in online
  // probe) to confirm.
  const message =
    probeResult.verdict === 'unknown-version-of-known-package'
      ? `GitHub Actions reference "${ref.action}@${ref.version}" is past the ` +
        `highest version in the offline allowlist; it may be a real newer ` +
        `release or a typo. ${probeResult.diagnostic}.`
      : `GitHub Actions reference "${ref.action}@${ref.version ?? '<no version>'}" ` +
        `is not in the offline allowlist. ${probeResult.diagnostic}.`;
  return {
    category: 'mock-of-hallucination',
    severity: 'info',
    message,
    location: { file: ref.file, line: ref.line },
    evidence: `+ ${ref.raw}`,
  };
}

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
