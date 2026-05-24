// Offline-allowlist probe. The bundled table covers the GitHub Actions
// marketplace entries the v10.1 real-corpus baseline showed as the
// failure mode (the `actions/checkout@v6` / `setup-node@v6` and the
// nonexistent Dependabot endpoint hallucinations); the table is
// deliberately small so the bundle stays JSON-light. The npm / PyPI /
// crates.io maps cover top packages typically mocked in tests so
// `mock-of-hallucination` does not need to round-trip the network
// just to confirm `requests` or `axios` exists.
//
// Snapshot dates are recorded so consumers can hedge on stale data.

import type { ProbeQuery, ProbeResult, RegistryProbe, RegistryName } from './types';

interface AllowlistEntry {
  /** Maximum known version, or `null` if any version is acceptable. */
  maxVersion: string | null;
}

const SNAPSHOT_DATE = '2026-05-24';

const GITHUB_ACTIONS_ALLOWLIST: Record<string, AllowlistEntry> = {
  'actions/checkout': { maxVersion: 'v4' },
  'actions/setup-node': { maxVersion: 'v4' },
  'actions/setup-python': { maxVersion: 'v5' },
  'actions/setup-go': { maxVersion: 'v5' },
  'actions/setup-java': { maxVersion: 'v4' },
  'actions/setup-dotnet': { maxVersion: 'v4' },
  'actions/cache': { maxVersion: 'v4' },
  'actions/upload-artifact': { maxVersion: 'v4' },
  'actions/download-artifact': { maxVersion: 'v4' },
  'actions/labeler': { maxVersion: 'v5' },
  'actions/stale': { maxVersion: 'v9' },
  'docker/build-push-action': { maxVersion: 'v6' },
  'docker/login-action': { maxVersion: 'v3' },
  'docker/setup-buildx-action': { maxVersion: 'v3' },
  'docker/metadata-action': { maxVersion: 'v5' },
  'docker/setup-qemu-action': { maxVersion: 'v3' },
  'codecov/codecov-action': { maxVersion: 'v4' },
  'github/codeql-action/init': { maxVersion: 'v3' },
  'github/codeql-action/analyze': { maxVersion: 'v3' },
  'github/codeql-action/upload-sarif': { maxVersion: 'v3' },
  'aws-actions/configure-aws-credentials': { maxVersion: 'v4' },
  'pnpm/action-setup': { maxVersion: 'v4' },
  'peaceiris/actions-gh-pages': { maxVersion: 'v4' },
};

const NPM_ALLOWLIST = new Set<string>([
  'lodash', 'axios', 'react', 'react-dom', 'react-router', 'react-router-dom',
  'vue', 'vuex', 'next', 'express', 'koa', 'fastify', 'hapi',
  'jest', 'mocha', 'chai', 'vitest', 'sinon', 'ava',
  'typescript', 'eslint', 'prettier', 'tsx', 'ts-node',
  'webpack', 'vite', 'rollup', 'parcel', 'esbuild',
  'commander', 'yargs', 'minimist', 'chalk', 'kleur',
  'pg', 'mysql', 'mysql2', 'sqlite3', 'better-sqlite3', 'redis', 'ioredis', 'mongoose', 'mongodb',
  'graphql', 'apollo-server', '@apollo/client',
  'rxjs', 'lodash-es', 'ramda', 'immutable', 'immer',
  '@octokit/rest', '@octokit/core', '@octokit/graphql',
  'fs-extra', 'glob', 'fast-glob', 'micromatch', 'minimatch',
  'date-fns', 'dayjs', 'moment', 'luxon',
  'uuid', 'nanoid', 'cuid',
  'zod', 'yup', 'joi', 'ajv',
  'cors', 'helmet', 'morgan', 'body-parser',
  '@anthropic-ai/sdk', 'openai', 'langchain', '@langchain/core',
  'parse-diff',
]);

const PYPI_ALLOWLIST = new Set<string>([
  'requests', 'urllib3', 'httpx', 'aiohttp',
  'numpy', 'pandas', 'scipy', 'matplotlib', 'seaborn', 'plotly',
  'scikit-learn', 'sklearn', 'tensorflow', 'torch', 'transformers',
  'flask', 'django', 'fastapi', 'pyramid', 'starlette', 'uvicorn',
  'pytest', 'pytest-asyncio', 'pytest-cov', 'nose2', 'unittest2',
  'pydantic', 'attrs', 'dataclasses-json',
  'sqlalchemy', 'psycopg2', 'psycopg2-binary', 'pymongo', 'redis',
  'pyjwt', 'cryptography', 'bcrypt', 'passlib',
  'celery', 'kombu', 'rq',
  'beautifulsoup4', 'bs4', 'lxml', 'html5lib',
  'pyyaml', 'toml', 'ruamel.yaml',
  'click', 'typer', 'argparse', 'argcomplete',
  'rich', 'tqdm', 'colorama',
  'python-dotenv', 'environs',
  'openai', 'anthropic', 'langchain',
]);

const CRATES_ALLOWLIST = new Set<string>([
  'serde', 'serde_json', 'tokio', 'async-std', 'futures',
  'reqwest', 'hyper', 'axum', 'actix-web', 'rocket',
  'clap', 'structopt', 'tracing', 'log', 'env_logger',
  'anyhow', 'thiserror', 'eyre',
  'chrono', 'time', 'uuid',
  'regex', 'lazy_static', 'once_cell',
  'rand', 'sha2', 'sha1', 'md5', 'blake3',
  'diesel', 'sqlx', 'sea-orm',
  'tonic', 'prost', 'grpcio',
  'serde_yaml', 'toml', 'config',
  'rayon', 'crossbeam', 'parking_lot',
]);

export class OfflineAllowlistProbe implements RegistryProbe {
  snapshotDate(): string {
    return SNAPSHOT_DATE;
  }

  query(q: ProbeQuery): ProbeResult {
    if (q.registry === 'github-actions') return this.queryGithubAction(q);
    const set = this.allowlistFor(q.registry);
    if (set.has(q.name)) {
      return result('known', `package is in the offline allowlist`, false);
    }
    return result(
      'unknown',
      `package "${q.name}" is not in the offline allowlist for ${q.registry}; ` +
        `re-run with --online to confirm against the live registry`,
      false,
    );
  }

  private queryGithubAction(q: ProbeQuery): ProbeResult {
    const entry = GITHUB_ACTIONS_ALLOWLIST[q.name];
    if (entry === undefined) {
      return result(
        'unknown',
        `action "${q.name}" is not in the offline allowlist; ` +
          `re-run with --online to confirm against the GitHub Actions marketplace`,
        false,
      );
    }
    if (q.version === undefined || entry.maxVersion === null) {
      return result('known', `action "${q.name}" is in the allowlist`, false);
    }
    if (versionRank(q.version) > versionRank(entry.maxVersion)) {
      return result(
        'unknown-version-of-known-package',
        `action "${q.name}@${q.version}" is past the highest known version (${entry.maxVersion})`,
        false,
      );
    }
    return result(
      'known',
      `action "${q.name}@${q.version}" is at or below the highest known version (${entry.maxVersion})`,
      false,
    );
  }

  private allowlistFor(registry: RegistryName): ReadonlySet<string> {
    switch (registry) {
      case 'npm':
        return NPM_ALLOWLIST;
      case 'pypi':
        return PYPI_ALLOWLIST;
      case 'crates':
        return CRATES_ALLOWLIST;
      /* istanbul ignore next */
      default:
        return new Set();
    }
  }
}

function result(verdict: ProbeResult['verdict'], diagnostic: string, fromNetwork: boolean): ProbeResult {
  return { verdict, diagnostic, snapshotDate: SNAPSHOT_DATE, fromNetwork };
}

/**
 * Coarse version comparator. Strips a leading `v`, parses the first
 * integer, and returns it. Sufficient for the
 * `actions/checkout@v6 > v4` case the v10.1 real-corpus baseline
 * needed; finer-grained semver comparison would require a runtime
 * dep we want to avoid.
 */
function versionRank(version: string): number {
  const stripped = version.startsWith('v') ? version.slice(1) : version;
  const m = stripped.match(/^(\d+)/);
  if (m === null) return Number.MAX_SAFE_INTEGER;
  return Number(m[1]);
}
