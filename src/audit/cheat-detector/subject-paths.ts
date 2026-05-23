// Decide whether a given file path in a PR diff is subject to
// cheat-detection.
//
// A `.diff` or `.patch` file is data, not code: its lines that begin
// with `+jest.mock(...)` are sample fixture content, not real mocks
// being introduced into the project. Likewise, files under conventional
// fixture / corpus directories exist precisely to demonstrate the
// patterns the detectors look for; flagging them would convert every
// detector test suite into a self-block.
//
// The exclusion is a property of the *path*, not the *file content*,
// so the same rule applies in every consumer repo. Audit tooling that
// needs to override the rule (e.g. a project that genuinely ships
// .diff files as production assets) can pre-filter before calling the
// engine.

// Extensions that hold data or prose, not executable code. A unified
// diff (.diff/.patch) and prose formats (markdown, restructuredtext)
// can quote cheat patterns as text without those patterns being live
// in the codebase. Treating them as audit subjects produces only false
// positives.
const DATA_EXTENSIONS = new Set([
  '.diff',
  '.patch',
  '.md',
  '.mdc',
  '.markdown',
  '.rst',
  '.txt',
  '.adoc',
]);

// Path segments that mark a directory as containing fixture / corpus
// / generated data. Matched case-insensitively against each path
// segment.
const FIXTURE_SEGMENTS = new Set([
  'fixtures',
  '__fixtures__',
  'corpus',
  'falsification-corpus',
  'snapshots',
  '__snapshots__',
]);

export function isAuditSubjectPath(filePath: string | undefined | null): boolean {
  if (filePath === undefined || filePath === null || filePath.length === 0) return false;
  const normalized = filePath.replace(/\\/g, '/');

  const dot = normalized.lastIndexOf('.');
  if (dot >= 0) {
    const ext = normalized.slice(dot).toLowerCase();
    if (DATA_EXTENSIONS.has(ext)) return false;
  }

  const segments = normalized.split('/');
  for (const seg of segments) {
    if (FIXTURE_SEGMENTS.has(seg.toLowerCase())) return false;
  }

  return true;
}
