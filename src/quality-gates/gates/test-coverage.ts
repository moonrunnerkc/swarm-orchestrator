import { maybe_read_text } from '../file-utils';
import { GateContext, GateIssue, GateResult, TestCoverageConfig } from '../types';

// Patterns that indicate a file is an entry point (not a standalone module needing its own test).
// The (^|\/) prefix handles monorepo layouts like frontend/src/main.jsx alongside flat src/main.tsx.
const DEFAULT_ENTRY_PATTERNS = [
  /(^|\/)src\/(main|index)\.(tsx?|jsx?|mjs)$/,
  /(^|\/)src\/app\.(tsx?|jsx?)$/i
];

export async function run_test_coverage_gate(
  ctx: GateContext,
  config: TestCoverageConfig,
  maxFileSizeBytes: number
): Promise<GateResult> {
  const start = Date.now();
  const issues: GateIssue[] = [];

  // Custom patterns extend the structural defaults (main/index/app are always
  // entry points regardless of project config), not replace them.
  const customPatterns = config.entryPointPatterns.map(p => new RegExp(p, 'i'));
  const entryPatterns = [...DEFAULT_ENTRY_PATTERNS, ...customPatterns];

  // Identify source files that should have tests
  const sourceFiles = ctx.files.filter(f => {
    if (!/\.(tsx?|jsx?|mjs)$/i.test(f.relativePath)) return false;
    if (/^(test|tests|__tests__)\//.test(f.relativePath)) return false;
    if (/\.test\.|\.spec\./.test(f.relativePath)) return false;
    // Root-level test scripts (test.js, tests.js) are test files, not source
    if (/^tests?\.(tsx?|jsx?|mjs)$/i.test(f.relativePath)) return false;
    // Integration/e2e test files at root level
    if (/^(integration|e2e)[.-]/i.test(f.relativePath)) return false;
    if (/^(server|config|scripts|examples?|deploy|benchmarks)\//.test(f.relativePath)) return false;
    // Test setup/config files nested inside src/ (e.g. src/test/setup.js,
    // src/setupTests.ts, frontend/src/test/setup.js) are test infrastructure
    if (/\btest\/setup\b|\bsetup[Tt]ests?\b|\btestSetup\b/i.test(f.relativePath)) return false;
    // Exclude standalone server entry points (e.g. src/server.js that just calls app.listen)
    if (/\bserver\.(tsx?|jsx?|mjs)$/i.test(f.relativePath)) return false;
    // Exclude vite/webpack configs and similar build tooling
    if (/\.(config|d)\.(ts|js|mjs)$/i.test(f.relativePath)) return false;
    // Exclude root-level entry scripts (start-*, index.js, app.js) outside src/
    if (!/\//.test(f.relativePath) || /^[^/]+\.(js|mjs)$/.test(f.relativePath)) {
      if (/^(start|launch|boot|serve)[-.]/i.test(f.relativePath)) return false;
    }
    // Exclude entry points
    if (entryPatterns.some(p => p.test(f.relativePath))) return false;
    // Exclude Ink TUI components: .tsx files importing from 'ink' are terminal UI
    // renderers that require ink-testing-library, not standard DOM test utilities.
    // Coverage comes from integration tests that exercise the underlying data model.
    if (/\.tsx$/i.test(f.relativePath)) {
      const text = f.text ?? maybe_read_text(f, maxFileSizeBytes);
      if (text && /from\s+['"]ink['"]|require\s*\(\s*['"]ink['"]\)/.test(text)) {
        return false;
      }
    }
    return true;
  });

  // Identify test files: convention-named (.test./.spec.) and root-level test scripts
  const testFiles = ctx.files.filter(f =>
    /\.(test|spec)\.(tsx?|jsx?|mjs)$/i.test(f.relativePath) ||
    /^tests?\.(tsx?|jsx?|mjs)$/i.test(f.relativePath)
  );

  // Collect all require/import edges from every source and test file so we
  // can resolve transitive coverage. An integration test importing app.js
  // should count as covering the controllers, middleware, and routes that
  // app.js itself requires.
  const allFiles = [...ctx.files];
  const fileImports = new Map<string, string[]>();
  const importRegex = /(?:from\s+['"]|require\s*\(\s*['"])([^'"]+)['"]/g;

  // Resolve a relative import specifier against the importing file's directory
  function resolveImport(specifier: string, importerRelPath: string): string {
    const stripped = specifier.replace(/\.(js|ts|jsx|tsx|mjs)$/, '');
    if (!specifier.startsWith('.')) return stripped;

    const importerKey = importerRelPath.replace(/\.(js|ts|jsx|tsx|mjs)$/, '');
    const slashIdx = importerKey.lastIndexOf('/');
    let dir = slashIdx >= 0 ? importerKey.substring(0, slashIdx) : '';

    let remaining = stripped;
    if (remaining.startsWith('./')) {
      remaining = remaining.substring(2);
    } else {
      while (remaining.startsWith('../')) {
        remaining = remaining.substring(3);
        const parentSlash = dir.lastIndexOf('/');
        dir = parentSlash >= 0 ? dir.substring(0, parentSlash) : '';
      }
    }
    return dir ? `${dir}/${remaining}` : remaining;
  }

  for (const f of allFiles) {
    if (!/\.(tsx?|jsx?|mjs)$/i.test(f.relativePath)) continue;
    const text = f.text ?? maybe_read_text(f, maxFileSizeBytes);
    if (!text) continue;

    const imports: string[] = [];
    let m: RegExpExecArray | null;
    importRegex.lastIndex = 0;
    while ((m = importRegex.exec(text)) !== null) {
      if (!m[1].startsWith('.')) continue;
      imports.push(resolveImport(m[1], f.relativePath));
    }
    const key = f.relativePath.replace(/\.(js|ts|jsx|tsx|mjs)$/, '');
    fileImports.set(key, imports);

    // Register barrel alias: directory imports resolve to dir/index
    const basename = key.split('/').pop();
    if (basename === 'index') {
      const dirKey = key.replace(/\/index$/, '');
      fileImports.set(dirKey, imports);
    }
  }

  // Walk transitive imports from test files to build the full coverage set
  const importedByTests = new Set<string>();
  function walkImports(moduleKey: string, visited: Set<string>): void {
    if (visited.has(moduleKey)) return;
    visited.add(moduleKey);
    importedByTests.add(moduleKey);
    const deps = fileImports.get(moduleKey) || fileImports.get(`src/${moduleKey}`) || [];
    for (const dep of deps) {
      walkImports(dep, visited);
      // Also try with src/ prefix
      if (!dep.startsWith('src/')) {
        walkImports(`src/${dep}`, visited);
      }
    }
  }

  for (const tf of testFiles) {
    const text = tf.text ?? maybe_read_text(tf, maxFileSizeBytes);
    if (!text) continue;

    importRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(text)) !== null) {
      if (!match[1].startsWith('.')) continue;
      const resolved = resolveImport(match[1], tf.relativePath);
      walkImports(resolved, new Set<string>());
    }
  }

  // 1. Check that each source file has a corresponding test or is imported by a test.
  //    Only flag files created by agents; pre-existing files are the project owner's concern.
  for (const src of sourceFiles) {
    if (ctx.baselineFiles?.has(src.relativePath)) continue;
    const baseName = src.relativePath
      .replace(/^src\//, '')
      .replace(/\.(tsx?|jsx?|mjs)$/, '');

    const hasDirectTest = testFiles.some(tf => {
      const testBase = tf.relativePath
        .replace(/^(test|tests|__tests__)\//, '')
        .replace(/^(unit|integration|e2e)\//, '')
        .replace(/\.(test|spec)\.(tsx?|jsx?|mjs)$/, '');
      // Match by full relative path, by stripping common prefixes, or
      // by filename only (test/unit/foo.test.js covers src/services/foo.js)
      const testBaseName = testBase.split('/').pop() || testBase;
      const srcBaseName = baseName.split('/').pop() || baseName;
      return testBase === baseName
        || testBase === baseName.replace(/^utils\//, '')
        || testBaseName === srcBaseName;
    });

    const isImportedByTest = importedByTests.has(`src/${baseName}`) ||
      importedByTests.has(baseName) ||
      importedByTests.has(src.relativePath.replace(/\.(tsx?|jsx?|mjs)$/, ''));

    if (!hasDirectTest && !isImportedByTest) {
      issues.push({
        message: `no test coverage for ${src.relativePath}`,
        filePath: src.relativePath,
        hint: `create a test file or import ${src.relativePath} in an existing test`
      });
    }
  }

  // 2. Check that test files contain real assertions (not empty stubs).
  //    Only validate agent-created test files, not pre-existing ones.
  for (const tf of testFiles) {
    if (ctx.baselineFiles?.has(tf.relativePath)) continue;
    const text = tf.text ?? maybe_read_text(tf, maxFileSizeBytes);
    if (!text) continue;

    const assertionPatterns = /\b(assert\.|expect\(|\.toBe|\.toEqual|\.toThrow|\.ok\(|\.strictEqual|\.deepEqual|\.deepStrictEqual|\.match\(|\.rejects|\.resolves)/;
    const assertionCount = (text.match(new RegExp(assertionPatterns.source, 'g')) || []).length;

    if (assertionCount < config.minTestAssertions) {
      issues.push({
        message: `${tf.relativePath} has ${assertionCount} assertion(s), minimum is ${config.minTestAssertions}`,
        filePath: tf.relativePath,
        hint: 'add meaningful assertions that verify module behavior'
      });
    }
  }

  // 3. Check for component-level tests in React projects
  // Skip for Ink (terminal UI) projects where DOM testing libraries don't apply.
  if (config.requireComponentTests) {
    const isReactProject = ctx.files.some(f => {
      const text = f.text ?? maybe_read_text(f, maxFileSizeBytes);
      if (!text) return false;
      return /from\s+['"]react['"]|require\s*\(\s*['"]react['"]\)/.test(text);
    });

    const isInkProject = ctx.files.some(f => {
      const text = f.text ?? maybe_read_text(f, maxFileSizeBytes);
      if (!text) return false;
      return /from\s+['"]ink['"]|require\s*\(\s*['"]ink['"]\)/.test(text);
    });

    if (isReactProject && !isInkProject) {
      const hasComponentTest = testFiles.some(f => {
        const text = f.text ?? maybe_read_text(f, maxFileSizeBytes);
        if (!text) return false;
        return /(render\s*\(|screen\.|document\.|getBy|queryBy|findBy|innerHTML|textContent|@testing-library)/i.test(text);
      });

      if (!hasComponentTest) {
        issues.push({
          message: 'React project has no component-level tests',
          hint: 'add at least one test that renders a component and asserts DOM output'
        });
      }
    }
  }

  const durationMs = Date.now() - start;
  const status: GateResult['status'] = issues.length > 0 ? 'fail' : 'pass';

  return {
    id: 'test-coverage',
    title: 'Test coverage checks',
    status,
    durationMs,
    issues,
    stats: {
      sourceFiles: sourceFiles.length,
      testFiles: testFiles.length,
      issues: issues.length
    }
  };
}
