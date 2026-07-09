// Local PR-fixture seam for `swarm audit --pr`. FAIL-CLOSED and inert in
// production: every function here returns null/undefined unless the
// `SWARM_PR_FIXTURE_DIR` environment variable points at a fixture directory. It
// exists so a planted-cheat fixture can be driven end-to-end through the shipped
// audit CLI (detector -> candidate selection -> execution-grounded engines ->
// attestation -> ledger -> gate exit) with a LOCAL git repo standing in for the
// GitHub fetch + clone, which are separately proven (closeout LIVE-PATH-POLYGLOT,
// 4/4) and re-exercised live by the backfill hunt. It never fabricates a verdict:
// the real engines run against the real checked-out fixture source.
//
// A fixture directory contains:
//   - fixture.json  : the PR metadata manifest (see PrFixtureManifest)
//   - <diffPath>    : the unified diff (default `pr.diff`)
//   - <repoPath>/   : a local git repo carrying the base and head commits, with
//                     uploadpack.allowAnySHA1InWant set so a depth-1 sha fetch works

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../logger';

const log = getLogger('audit:pr-fixture');

/** The fixture manifest. Mirrors exactly the fields fetchPrContext derives from
 *  the GitHub API, so the audit sees an identical PrContext shape. */
export interface PrFixtureManifest {
  repo: string;
  number: number;
  title: string;
  body: string;
  author: string;
  headRef: string;
  headSha: string;
  baseSha: string;
  commitMessages?: string[];
  /** Relative path to the unified diff within the fixture dir (default `pr.diff`). */
  diffPath?: string;
  /** Relative path to the local git repo within the fixture dir (default `repo`). */
  repoPath?: string;
}

/** The PrContext shape the audit consumes (kept structural to avoid importing the
 *  private interface from pr-fetch). */
export interface FixturePrContext {
  prMetadata: {
    number: number;
    headSha: string;
    baseSha: string;
    title: string;
    body: string;
    author: string;
    headRef: string;
    repository: string;
  };
  fingerprintInput: {
    prTitle: string;
    prBody: string;
    headRef: string;
    authors: string[];
    commitMessages: string[];
  };
}

function fixtureDir(): string | null {
  const dir = process.env.SWARM_PR_FIXTURE_DIR;
  if (dir === undefined || dir.trim().length === 0) return null;
  return dir.trim();
}

/** Read and parse the fixture manifest, or null when no fixture is configured.
 *  Throws only when the env var IS set but the manifest is missing/invalid, so a
 *  misconfigured fixture fails loudly rather than silently falling back to GitHub. */
export function loadPrFixtureManifest(): PrFixtureManifest | null {
  const dir = fixtureDir();
  if (dir === null) return null;
  const manifestPath = path.join(dir, 'fixture.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `SWARM_PR_FIXTURE_DIR is set to ${dir} but ${manifestPath} does not exist; ` +
        'write a fixture.json manifest or unset SWARM_PR_FIXTURE_DIR',
    );
  }
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PrFixtureManifest;
  log.info(`using local PR fixture ${parsed.repo}#${parsed.number} from ${dir} (SWARM_PR_FIXTURE_DIR set)`);
  return parsed;
}

/** The fixture's unified diff, or null when no fixture is configured. */
export function fixturePrDiff(): string | null {
  const manifest = loadPrFixtureManifest();
  if (manifest === null) return null;
  const dir = fixtureDir()!;
  return fs.readFileSync(path.join(dir, manifest.diffPath ?? 'pr.diff'), 'utf8');
}

/** The fixture's PrContext, or null when no fixture is configured. */
export function fixturePrContext(): FixturePrContext | null {
  const m = loadPrFixtureManifest();
  if (m === null) return null;
  return {
    prMetadata: {
      number: m.number,
      headSha: m.headSha,
      baseSha: m.baseSha,
      title: m.title,
      body: m.body,
      author: m.author,
      headRef: m.headRef,
      repository: m.repo,
    },
    fingerprintInput: {
      prTitle: m.title,
      prBody: m.body,
      headRef: m.headRef,
      authors: [m.author],
      commitMessages: m.commitMessages ?? [],
    },
  };
}

/**
 * The local clone URL for `repo` when a fixture is configured and its repo name
 * matches, else null (production and non-matching repos fall through to GitHub).
 * Used by the sandbox provisioner to clone the fixture's local git repo instead
 * of github.com. Returns an absolute path git accepts as a remote.
 *
 * @param repo the `owner/name` the provisioner is about to clone.
 * @returns the absolute local repo path, or null to use GitHub.
 */
export function fixtureRepoUrl(repo: string): string | null {
  const dir = fixtureDir();
  if (dir === null) return null;
  let manifest: PrFixtureManifest;
  try {
    const parsed = loadPrFixtureManifest();
    if (parsed === null) return null;
    manifest = parsed;
  } catch (err) {
    log.debug(`fixtureRepoUrl: manifest unreadable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  if (manifest.repo !== repo) return null;
  const repoPath = path.resolve(dir, manifest.repoPath ?? 'repo');
  return fs.existsSync(repoPath) ? repoPath : null;
}
