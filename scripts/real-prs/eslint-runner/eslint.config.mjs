// Flat config for the differential ESLint run. Loads eslint-plugin-security
// and eslint-plugin-no-secrets against JS/TS files. This config and its
// toolchain are deliberately isolated from the repo's own ESLint so the
// security rule set never gates this project's source; it exists only to
// ask, on the corpus PRs, what ESLint's security rules catch that the
// auditor does not (and the reverse).

import parser from '@typescript-eslint/parser';
import security from 'eslint-plugin-security';
import noSecrets from 'eslint-plugin-no-secrets';

export default [
  {
    files: ['**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}'],
    languageOptions: {
      parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    plugins: { security, 'no-secrets': noSecrets },
    rules: {
      ...security.configs.recommended.rules,
      'no-secrets/no-secrets': ['warn', { tolerance: 4.5 }],
    },
  },
];
