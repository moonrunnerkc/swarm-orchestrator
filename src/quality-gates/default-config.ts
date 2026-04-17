import { QualityGatesConfig } from './types';

export const DEFAULT_QUALITY_GATES_CONFIG: QualityGatesConfig = {
  enabled: true,
  failOnIssues: true,
  autoAddRefactorStepOnDuplicateBlocks: true,
  autoAddReadmeTruthStepOnReadmeClaims: true,
  autoAddScaffoldFixStepOnScaffoldDefaults: true,
  autoAddConfigFixStepOnHardcodedConfig: true,
  autoAddAccessibilityFixStepOnAccessibility: true,
  autoAddTestCoverageStepOnTestCoverage: true,
  excludeDirNames: [
    '.git',
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.next',
    '.turbo',
    '.cache',
    '.context',
    '.locks',
    'runs',
    'plans',
    'proof',
    '.quickfix',
    'fixtures',
    // Python virtual environments and build artifacts
    'venv',
    '.venv',
    'env',
    '.env',
    '__pycache__',
    '.tox',
    '.mypy_cache',
    '.pytest_cache',
    '.ruff_cache',
    '.eggs',
    'site-packages',
    // Ruby / Rust / Go / Java build dirs
    'vendor',
    'target',
    '.gradle',
    // IDE and OS artifacts
    '.idea',
    '.vscode',
    '.vs'
  ],
  maxFileSizeBytes: 512 * 1024,
  gates: {
    scaffoldDefaults: {
      enabled: true,
      bannedTitleRegexes: [
        'Vite \\+ React',
        'React App',
        'Next\\.js App',
        'SvelteKit'
      ],
      bannedReadmeRegexes: [
        'This project was bootstrapped with',
        'Vite\\s+\\+\\s+React',
        'Create React App'
      ],
      bannedFiles: [
        'public/vite.svg',
        'src/logo.svg',
        'public/favicon.ico'
      ]
    },
    duplicateBlocks: {
      enabled: true,
      minLines: 12,
      maxOccurrences: 2,
      maxFindings: 20,
      excludeFileRegexes: [
        '^package-lock\\.json$',
        '^pnpm-lock\\.yaml$',
        '^yarn\\.lock$',
        '^test-output\\.txt$',
        '^dist/',
        '^build/',
        '^coverage/',
        '^runs/',
        '^plans/',
        '^proof/',
        '^venv/',
        '^\\.venv/',
        '^env/',
        '^vendor/',
        '^target/',
        '^__pycache__/'
      ]
    },
    hardcodedConfig: {
      enabled: true,
      bannedLiteralRegexes: [
        'https?://localhost(?::\\d+)?',
        'https?://127\\.0\\.0\\.1(?::\\d+)?',
        'RETRY_COUNT\\s*=\\s*[0-9]+'
      ],
      allowIfFileContainsRegexes: [
        'process\\.env\\.',
        'import\\.meta\\.env',
        'window\\.__CONFIG__'
      ],
      excludeFileRegexes: [
        '^\.github/',
        '\\.(md|mdx)$',
        '^dist/',
        '^build/',
        '^coverage/',
        '^runs/',
        '^plans/',
        '^proof/',
        '^venv/',
        '^\\.venv/',
        '^env/',
        '^vendor/',
        '^target/',
        '^__pycache__/',
        '^benchmarks/',
        '^test/fixtures/',
        '(^|/)tests?/',
        '(^|/)__tests__/',
        '\\.(test|spec)\\.(ts|js|tsx|jsx|mjs)$',
        '(^|/)test_[^/]*\\.py$',
        '^(integration|e2e)[.-]',
        '^test\\.(js|ts|mjs)$',
        '^tests\\.(js|ts|mjs)$',
        '^(deploy|scripts)/',
        '\\.(sh|bash|bat|cmd|ps1)$',
        'vite\\.config\\.(js|ts|mjs|mts)$',
        'webpack\\.config\\.(js|ts)$',
        '\\.env(\\.example|\\.local)?$',
        '^docker-compose[^/]*\\.ya?ml$',
        '(^|/)Dockerfile',
        '\\.dockerfile$'
      ]
    },
    readmeClaims: {
      enabled: true,
      claimRules: [
        {
          id: 'claim-retry',
          readmeRegex: '\\b(retry|retries|backoff|exponential backoff)\\b',
          requiredEvidence: [
            { fileRegex: 'src/.+', contentRegex: '\\bretry\\b', note: 'expected a retry helper or implementation' }
          ]
        },
        {
          id: 'claim-optimistic-ui',
          readmeRegex: '\\boptimistic\\b',
          requiredEvidence: [
            { fileRegex: 'src/.+', contentRegex: '\\boptimistic\\b', note: 'expected optimistic UI implementation' }
          ]
        },
        {
          id: 'claim-correlation-id',
          readmeRegex: '\\bcorrelation id\\b|\\bx-correlation-id\\b',
          requiredEvidence: [
            { fileRegex: 'src/.+', contentRegex: 'x-correlation-id|correlationId', note: 'expected correlation ID support in code' }
          ]
        },
        {
          id: 'claim-request-logging',
          readmeRegex: '\\brequest logging\\b|\\blog requests\\b',
          requiredEvidence: [
            { fileRegex: 'src/.+', contentRegex: 'req\\.method|morgan', note: 'expected request logging middleware' }
          ]
        }
      ]
    },
    testIsolation: {
      enabled: true,
      mutableStoreRegexes: [
        '^\\s*let\\s+\\w+\\s*=\\s*\\[\\s*\\]\\s*;\\s*$',
        '^\\s*let\\s+\\w+\\s*=\\s*\\{\\s*\\}\\s*;\\s*$'
      ],
      allowIfFileContainsRegexes: [
        'resetForTests',
        '__reset',
        'clearAll',
        'beforeEach\\('
      ],
      testFileRegexes: [
        '^(test|tests)/.+\\.test\\.(ts|js|tsx|jsx)$',
        '^__tests__/.+\\.(ts|js|tsx|jsx)$',
        '\\.test\\.(ts|js|tsx|jsx)$',
        '\\.spec\\.(ts|js|tsx|jsx)$'
      ],
      allowIfAnyTestContainsRegexes: [
        'beforeEach\\(',
        'afterEach\\('
      ]
    },
    runtimeChecks: {
      enabled: true,
      retries: 1,
      runTests: true,
      runLint: true,
      runAudit: true,
      timeoutMs: 120000
    },
    accessibility: {
      enabled: true,
      requireSkipLink: true,
      requireHeadingHierarchy: true,
      requireAriaLabels: true,
      requireFocusStyles: true,
      requireReducedMotion: true,
      requireNoPhantomAssets: true,
      requireMetaTags: true,
      requireResponsiveCSS: true,
      requireColorScheme: true,
      requireSemanticHTML: true,
      requireImgAlt: true
    },
    testCoverage: {
      enabled: true,
      entryPointPatterns: [
        '^src/dashboard\\.tsx?$'
      ],
      minTestAssertions: 1,
      requireComponentTests: true    },
    testFileProtection: {
      enabled: true,
      testFileGlobs: [
        'tests/**',
        'test/**',
        '**/__tests__/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.test.js',
        '**/*.test.jsx',
        '**/*.spec.ts',
        '**/*.spec.js',
        '**/test_*.py',
        '**/*_test.py'
      ],
      maxFindings: 25    }
  }
};
