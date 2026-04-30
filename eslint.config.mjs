import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'examples/**',
      'plugin/**',
      'docs/**',
      '.venv/**',
      '**/.venv/**',
      'coverage/**',
      'scripts/**',
      'test/fixtures/**',
      // Benchmark fetch caches and harness run artifacts: generated trees
      // containing upstream OSS code or agent-produced workspaces. Gitignored
      // on CI, but may be present in local dev environments. Never our code;
      // never lint.
      '**/.cache/**',
      'benchmarks/constraint-binding/fixtures/**',
      'benchmarks/harness/raw_data/runs/**',
      // Gitignored demo subprojects per CLAUDE.md (orchestrator-regenerated
      // scaffolds). Match the top-level paths listed in .gitignore.
      'app/**',
      'calculator/**',
      'calculations-api/**',
      'logtail/**',
      'notes-api/**',
      'tictactoe/**',
      'web/**',
      '*.config.mjs',
      '*.config.js',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Project is "type": "commonjs"; require() is the native import form.
      '@typescript-eslint/no-require-imports': 'off',
      // TODO(stage-2b): tighten to 'error' after a dead-import cleanup sweep.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'preserve-caught-error': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
    },
  },
  {
    files: ['test/**/*.ts', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['src/dashboard.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Plain-JS files (no TypeScript compilation) are CommonJS Node scripts.
    // Declare Node globals so `require`/`module`/`process`/`__dirname` do not
    // fire `no-undef`. The runtime-checks quality gate runs `npx eslint` on
    // agent-changed files directly, so *.js files reached by that gate also
    // need this language-options block — it cannot rely on the npm-script's
    // scoped file glob.
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        global: 'readonly',
      },
    },
  },
);
