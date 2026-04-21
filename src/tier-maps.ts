// Tier maps: per-task-type requirement classifications.
// Pure data, no logic. Consumed by RequirementFilter to decide
// which requirements get injected, recommended, or suppressed.

import { TaskType } from './task-classifier';

export type TierLevel = 'enforce' | 'recommend' | 'skip';

export interface TierRequirement {
  id: string;
  description: string;
  tier: TierLevel;
  category: 'security' | 'validation' | 'testing' | 'accessibility' | 'structure' | 'documentation' | 'resilience' | 'polish';
}

export type TierMap = Record<TaskType, TierRequirement[]>;

const API_BACKEND_ENFORCE: TierRequirement[] = [
  { id: 'security-headers', description: 'Security headers on HTTP responses (X-Content-Type-Options, X-Frame-Options, CSP minimum)', tier: 'enforce', category: 'security' },
  { id: 'body-size-limit', description: 'Global request body size limit via middleware (e.g. express.json({ limit }), Starlette ContentSizeLimitMiddleware), not per-field max_length', tier: 'enforce', category: 'security' },
  { id: 'param-sanitization', description: 'ID and route parameter validation before route logic (regex or schema)', tier: 'enforce', category: 'validation' },
  { id: 'input-type-validation', description: 'Type checks on all input fields (reject non-string where string expected, etc.)', tier: 'enforce', category: 'validation' },
  { id: 'input-length-validation', description: 'Max length enforcement on string inputs', tier: 'enforce', category: 'validation' },
  { id: 'input-empty-validation', description: 'Empty and whitespace-only rejection on required fields', tier: 'enforce', category: 'validation' },
  { id: 'error-hide-internals', description: 'Error handler that never leaks err.message or stack traces to clients', tier: 'enforce', category: 'security' },
  { id: 'config-externalization', description: 'Environment-dependent values (PORT, DB paths, CORS origins, file paths) from env vars, not hardcoded', tier: 'enforce', category: 'structure' },
  { id: 'endpoint-tests', description: 'Tests for every endpoint covering happy path and at least one error path', tier: 'enforce', category: 'testing' },
  { id: 'validation-tests', description: 'Tests for every validation rule: positive (valid input accepted) and negative (invalid input rejected with correct status code and error shape) for each type check, length check, empty check, and schema constraint', tier: 'enforce', category: 'testing' },
  { id: 'gitignore', description: '.gitignore present with node_modules, dist, .env at minimum', tier: 'enforce', category: 'structure' },
  { id: 'package-json-complete', description: 'package.json with name, description, scripts (start, test, dev), engines', tier: 'enforce', category: 'structure' },
];

const API_BACKEND_RECOMMEND: TierRequirement[] = [
  { id: 'readme-api-docs', description: 'README with endpoint documentation and env var reference', tier: 'recommend', category: 'documentation' },
  { id: 'dockerfile', description: 'Dockerfile for containerized deployment', tier: 'recommend', category: 'structure' },
  { id: 'rate-limiting', description: 'Rate limiting middleware or configuration', tier: 'recommend', category: 'security' },
  { id: 'health-endpoint-timestamp', description: 'Health endpoint returns a timestamp, not just { status: "ok" }', tier: 'recommend', category: 'resilience' },
  { id: '404-unknown-routes', description: 'Catch-all handler for undefined routes returning JSON error', tier: 'recommend', category: 'resilience' },
  { id: 'test-isolation', description: 'Tests use temp directories with cleanup, not shared state', tier: 'recommend', category: 'testing' },
  { id: 'delete-returns-confirmation', description: 'DELETE endpoints return the deleted object or count, not empty 204', tier: 'recommend', category: 'structure' },
];

const API_BACKEND_SKIP: TierRequirement[] = [
  { id: 'audio-feedback', description: 'Any audio/sound features', tier: 'skip', category: 'polish' },
  { id: 'favicon', description: 'Custom favicons', tier: 'skip', category: 'polish' },
  { id: 'theme-color-meta', description: 'Theme color meta tags', tier: 'skip', category: 'polish' },
  { id: 'css-custom-properties', description: 'Elaborate CSS variable systems', tier: 'skip', category: 'polish' },
  { id: 'aria-attributes', description: 'ARIA labels (not relevant for APIs)', tier: 'skip', category: 'accessibility' },
  { id: 'responsive-layout', description: 'Responsive CSS (not relevant for APIs)', tier: 'skip', category: 'accessibility' },
  { id: 'skip-link', description: 'Skip navigation links (not relevant for APIs)', tier: 'skip', category: 'accessibility' },
  { id: 'dark-mode', description: 'Color scheme support (not relevant for APIs)', tier: 'skip', category: 'polish' },
];

const FRONTEND_WEB_ENFORCE: TierRequirement[] = [
  { id: 'aria-interactive', description: 'ARIA labels on all interactive elements (buttons, inputs, links, toggles)', tier: 'enforce', category: 'accessibility' },
  { id: 'keyboard-navigation', description: 'All interactive elements reachable and operable via keyboard', tier: 'enforce', category: 'accessibility' },
  { id: 'focus-visible', description: ':focus-visible styles on all interactive elements', tier: 'enforce', category: 'accessibility' },
  { id: 'semantic-html', description: 'Semantic landmarks (main, nav, header, section, article as appropriate)', tier: 'enforce', category: 'accessibility' },
  { id: 'responsive-breakpoint', description: 'At least one responsive breakpoint for mobile', tier: 'enforce', category: 'accessibility' },
  { id: 'error-states', description: 'Error state UI for failed operations (not just happy path)', tier: 'enforce', category: 'resilience' },
  { id: 'loading-states', description: 'Loading indicators for async operations', tier: 'enforce', category: 'resilience' },
  { id: 'empty-states', description: 'Empty state UI when no data exists', tier: 'enforce', category: 'resilience' },
  { id: 'input-validation-frontend', description: 'Client-side validation on form inputs before submission', tier: 'enforce', category: 'validation' },
  { id: 'component-tests', description: 'Tests for core UI logic (state changes, event handlers, data transformations)', tier: 'enforce', category: 'testing' },
  { id: 'gitignore', description: '.gitignore present', tier: 'enforce', category: 'structure' },
  { id: 'package-json-complete', description: 'package.json with name, description, scripts', tier: 'enforce', category: 'structure' },
];

const FRONTEND_WEB_RECOMMEND: TierRequirement[] = [
  { id: 'prefers-color-scheme', description: 'Dark mode via prefers-color-scheme media query', tier: 'recommend', category: 'accessibility' },
  { id: 'prefers-reduced-motion', description: 'Reduced motion support for animations', tier: 'recommend', category: 'accessibility' },
  { id: 'skip-link', description: 'Skip navigation link for screen readers', tier: 'recommend', category: 'accessibility' },
  { id: 'meta-description', description: 'Meta description tag', tier: 'recommend', category: 'documentation' },
  { id: 'readme', description: 'README with usage instructions', tier: 'recommend', category: 'documentation' },
  { id: 'css-custom-properties', description: 'CSS custom properties for theming (colors, spacing at minimum)', tier: 'recommend', category: 'structure' },
  { id: 'zero-dependencies', description: 'Prefer custom implementations over CDN dependencies where reasonable', tier: 'recommend', category: 'structure' },
];

const FRONTEND_WEB_SKIP: TierRequirement[] = [
  { id: 'audio-feedback', description: 'Web Audio API sounds', tier: 'skip', category: 'polish' },
  { id: 'favicon-custom', description: 'Custom inline SVG favicon', tier: 'skip', category: 'polish' },
  { id: 'theme-color-meta', description: 'Dual theme-color meta tags', tier: 'skip', category: 'polish' },
  { id: 'elaborate-animations', description: 'Complex animation systems', tier: 'skip', category: 'polish' },
  { id: 'security-headers', description: 'Security headers (not relevant for static frontends without a server)', tier: 'skip', category: 'security' },
];

const CLI_TOOL_ENFORCE: TierRequirement[] = [
  { id: 'arg-validation', description: 'Argument validation with clear, specific error messages including the invalid value', tier: 'enforce', category: 'validation' },
  { id: 'help-flag', description: '--help / -h flag with usage documentation', tier: 'enforce', category: 'documentation' },
  { id: 'missing-file-error', description: 'Graceful handling of missing files with specific path in error message', tier: 'enforce', category: 'resilience' },
  { id: 'permission-error', description: 'Graceful handling of permission errors with specific message', tier: 'enforce', category: 'resilience' },
  { id: 'exit-codes', description: 'Non-zero exit codes on errors (0 success, 1 user error, 2 system error)', tier: 'enforce', category: 'structure' },
  { id: 'core-logic-tests', description: 'Tests for all core logic functions (parsers, transformers, validators)', tier: 'enforce', category: 'testing' },
  { id: 'error-path-tests', description: 'Tests for all error conditions (missing file, bad input, permission denied)', tier: 'enforce', category: 'testing' },
  { id: 'gitignore', description: '.gitignore present', tier: 'enforce', category: 'structure' },
  { id: 'package-json-complete', description: 'package.json with name, description, bin field, engines', tier: 'enforce', category: 'structure' },
];

const CLI_TOOL_RECOMMEND: TierRequirement[] = [
  { id: 'short-flags', description: 'Short flag aliases (-h, -v, etc.) in addition to long forms', tier: 'recommend', category: 'structure' },
  { id: 'readme-usage', description: 'README with usage examples and flag documentation', tier: 'recommend', category: 'documentation' },
  { id: 'no-color-support', description: 'NO_COLOR env var and TTY detection for colored output', tier: 'recommend', category: 'resilience' },
  { id: 'stdin-support', description: 'Read from stdin when no file argument provided (where applicable)', tier: 'recommend', category: 'structure' },
  { id: 'config-env-vars', description: 'Configuration via environment variables where appropriate', tier: 'recommend', category: 'structure' },
];

const CLI_TOOL_SKIP: TierRequirement[] = [
  { id: 'aria-attributes', description: 'ARIA (not relevant)', tier: 'skip', category: 'accessibility' },
  { id: 'responsive-layout', description: 'Responsive CSS (not relevant)', tier: 'skip', category: 'accessibility' },
  { id: 'dark-mode', description: 'Browser dark mode (not relevant)', tier: 'skip', category: 'polish' },
  { id: 'favicon', description: 'Favicons (not relevant)', tier: 'skip', category: 'polish' },
  { id: 'audio-feedback', description: 'Audio (not relevant)', tier: 'skip', category: 'polish' },
  { id: 'security-headers', description: 'HTTP security headers (not relevant)', tier: 'skip', category: 'security' },
  { id: 'css-custom-properties', description: 'CSS variables (not relevant)', tier: 'skip', category: 'polish' },
];

const LIBRARY_PACKAGE_ENFORCE: TierRequirement[] = [
  { id: 'type-exports', description: 'All public API types exported and documented', tier: 'enforce', category: 'structure' },
  { id: 'input-validation', description: 'Validate public function inputs with descriptive errors', tier: 'enforce', category: 'validation' },
  { id: 'error-messages-specific', description: 'Error messages include the invalid value and expected format', tier: 'enforce', category: 'validation' },
  { id: 'unit-tests-core', description: 'Unit tests for all exported functions covering happy path, edge cases, error conditions', tier: 'enforce', category: 'testing' },
  { id: 'zero-side-effects', description: 'No side effects in library code (no console.log, no file writes, no network calls)', tier: 'enforce', category: 'structure' },
  { id: 'gitignore', description: '.gitignore present', tier: 'enforce', category: 'structure' },
  { id: 'package-json-complete', description: 'package.json with name, description, main/exports, types, engines, license', tier: 'enforce', category: 'structure' },
];

const LIBRARY_PACKAGE_RECOMMEND: TierRequirement[] = [
  { id: 'readme-api', description: 'README with API documentation and usage examples', tier: 'recommend', category: 'documentation' },
  { id: 'jsdoc-public', description: 'JSDoc on all public exports', tier: 'recommend', category: 'documentation' },
  { id: 'changelog', description: 'CHANGELOG.md', tier: 'recommend', category: 'documentation' },
  { id: 'test-edge-cases', description: 'Tests for boundary values, empty inputs, type mismatches', tier: 'recommend', category: 'testing' },
];

const LIBRARY_PACKAGE_SKIP: TierRequirement[] = [
  { id: 'aria-attributes', description: 'ARIA (not relevant for libraries)', tier: 'skip', category: 'accessibility' },
  { id: 'responsive-layout', description: 'Responsive CSS (not relevant for libraries)', tier: 'skip', category: 'accessibility' },
  { id: 'dark-mode', description: 'Browser dark mode (not relevant for libraries)', tier: 'skip', category: 'polish' },
  { id: 'favicon', description: 'Favicons (not relevant for libraries)', tier: 'skip', category: 'polish' },
  { id: 'audio-feedback', description: 'Audio (not relevant for libraries)', tier: 'skip', category: 'polish' },
  { id: 'security-headers', description: 'HTTP security headers (not relevant for libraries)', tier: 'skip', category: 'security' },
  { id: 'css-custom-properties', description: 'CSS variables (not relevant for libraries)', tier: 'skip', category: 'polish' },
  { id: 'skip-link', description: 'Skip navigation (not relevant for libraries)', tier: 'skip', category: 'accessibility' },
  { id: 'theme-color-meta', description: 'Theme color meta tags (not relevant for libraries)', tier: 'skip', category: 'polish' },
];

// Build the full-stack map from backend + frontend.
// Enforce: union of both. Recommend: union of both. Skip: only items both agree are irrelevant.
function buildFullStackMap(): TierRequirement[] {
  const seen = new Set<string>();
  const result: TierRequirement[] = [];

  // Enforce: union of backend + frontend enforce lists, deduplicated by id
  for (const req of [...API_BACKEND_ENFORCE, ...FRONTEND_WEB_ENFORCE]) {
    if (!seen.has(req.id)) {
      seen.add(req.id);
      result.push(req);
    }
  }

  // Recommend: union of backend + frontend recommend lists, deduplicated by id
  for (const req of [...API_BACKEND_RECOMMEND, ...FRONTEND_WEB_RECOMMEND]) {
    if (!seen.has(req.id)) {
      seen.add(req.id);
      result.push(req);
    }
  }

  // Skip: only items that appear in BOTH skip lists (intersection by id)
  const backendSkipIds = new Set(API_BACKEND_SKIP.map(r => r.id));
  for (const req of FRONTEND_WEB_SKIP) {
    if (backendSkipIds.has(req.id) && !seen.has(req.id)) {
      seen.add(req.id);
      result.push(req);
    }
  }

  return result;
}

export const TIER_MAPS: TierMap = {
  'api-backend': [...API_BACKEND_ENFORCE, ...API_BACKEND_RECOMMEND, ...API_BACKEND_SKIP],
  'frontend-web': [...FRONTEND_WEB_ENFORCE, ...FRONTEND_WEB_RECOMMEND, ...FRONTEND_WEB_SKIP],
  'cli-tool': [...CLI_TOOL_ENFORCE, ...CLI_TOOL_RECOMMEND, ...CLI_TOOL_SKIP],
  'library-package': [...LIBRARY_PACKAGE_ENFORCE, ...LIBRARY_PACKAGE_RECOMMEND, ...LIBRARY_PACKAGE_SKIP],
  'full-stack': buildFullStackMap(),
};
