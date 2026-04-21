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
      'coverage/**',
      'scripts/**',
      'test/fixtures/**',
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
      // Addressed in Stage 3 (silent catch audit); re-enable after cleanup.
      'preserve-caught-error': 'off',
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
);
