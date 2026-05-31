// Manifest-fetch helper for `swarm audit --pr <ref>`. Without it, the
// mock-of-hallucination detector reads manifests from `--repo-root`,
// which defaults to the cwd of whoever runs the audit — typically a
// different repo than the PR's. The detector then has no view of the
// target project's declared dependencies and flags every internal
// module mock as a hallucination.
//
// Two API calls per audit:
//   1. one Git Tree call (recursive) to enumerate every path in the
//      repo at the PR's head SHA
//   2. one Contents call per known manifest path that the tree
//      actually contains
//
// The tree call returns the entire path list, so we can filter to
// just the manifest paths before issuing any Contents requests.
// Across 48 PRs this is roughly 50-150 API calls total, well inside
// the authenticated 5000/hour budget.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Octokit } from '@octokit/rest';
import { getLogger } from '../../logger';
import { SwarmError } from '../../errors';
import type { GithubPrRef } from './pr-fetch';

const logger = getLogger('cli:v8:audit:manifest-fetch');

// Manifest filenames recognized by the cheat-detector's manifest
// readers. Match by basename; absent paths are skipped.
const MANIFEST_BASENAMES: ReadonlySet<string> = new Set([
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Gemfile',
  'Gemfile.lock',
  'composer.json',
]);

// Filename the detector reads for the list of internal directory
// roots discovered from the git tree. mock-of-hallucination uses this
// to recognize internal Python/JS dotted paths so it doesn't flag
// `integrations.jira_dc.foo` as a hallucinated pypi package.
const INTERNAL_ROOTS_FILENAME = '.swarm-internal-roots.txt';

// Per-audit cap on manifest files actually fetched. The tree
// enumeration is one call; this caps the followups. Even huge
// monorepos rarely have more than 20-30 manifest files; 64 is room
// to spare without risking burst rate-limits.
const MAX_FETCHES = 64;

interface ManifestFetchResult {
  /** Temp dir whose layout mirrors the fetched manifests. */
  tempRoot: string;
  /** Number of manifest files written. */
  fetched: number;
  /** Cleanup function. Idempotent. */
  cleanup(): void;
}

/**
 * Fetch the project manifests at the PR's head SHA. Returns a temp
 * dir whose layout mirrors the paths of the fetched manifests, or
 * `undefined` when nothing was fetched (no manifests on the target,
 * or the API was unavailable).
 *
 * Caller owns the temp dir's lifecycle via `cleanup()`.
 */
export async function fetchPrManifests(
  ref: GithubPrRef,
  _unifiedDiff: string,
  headSha: string,
): Promise<ManifestFetchResult | undefined> {
  const octokit = client();

  const treeResult = await enumerateRepoTree(octokit, ref, headSha);
  const manifestPaths = treeResult.manifestPaths;
  // Even if there are zero manifests, we still want to publish the
  // internal-roots file so mock-of-hallucination can resolve internal
  // dotted-module mocks. (Most repos have at least one manifest, so
  // this branch is rare.)
  if (manifestPaths.length === 0 && treeResult.directories.size === 0) {
    return undefined;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-audit-manifests-'));
  let fetched = 0;

  // Write the internal-roots file first so the detector can read it
  // regardless of whether any manifests fetched successfully.
  writeInternalRoots(tempRoot, treeResult.directories);

  for (const repoPath of manifestPaths) {
    if (fetched >= MAX_FETCHES) break;
    const content = await fetchFileContent(octokit, ref, repoPath, headSha);
    if (content === undefined) continue;
    const target = path.join(tempRoot, repoPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    fetched += 1;
  }

  // We have at least the internal-roots file at this point; even with
  // zero successful manifest fetches the temp dir is still useful.

  logger.debug(`fetched ${fetched} manifest file(s) to ${tempRoot}`);

  return {
    tempRoot,
    fetched,
    cleanup(): void {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch (err) {
        logger.debug(`manifest-fetch cleanup failed: ${(err as Error).message}`);
      }
    },
  };
}

function client(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  return token !== undefined && token.length > 0
    ? new Octokit({ auth: token })
    : new Octokit();
}

interface TreeEntry {
  path?: string;
  type?: string;
}

interface TreeResponse {
  tree?: TreeEntry[];
  truncated?: boolean;
}

interface TreeEnumeration {
  manifestPaths: string[];
  /** Set of bare directory names appearing anywhere in the tree. */
  directories: Set<string>;
}

async function enumerateRepoTree(
  octokit: Octokit,
  ref: GithubPrRef,
  headSha: string,
): Promise<TreeEnumeration> {
  const empty: TreeEnumeration = { manifestPaths: [], directories: new Set() };
  try {
    const response = await octokit.git.getTree({
      owner: ref.owner,
      repo: ref.repo,
      tree_sha: headSha,
      recursive: 'true',
    });
    const data = response.data as TreeResponse;
    if (data.truncated === true) {
      logger.debug(
        `git tree for ${ref.owner}/${ref.repo}@${headSha.slice(0, 7)} was truncated`,
      );
    }
    const manifestPaths: string[] = [];
    const directories = new Set<string>();
    for (const entry of data.tree ?? []) {
      if (entry.path === undefined) continue;
      if (entry.type === 'blob') {
        const base = basenameOf(entry.path);
        if (MANIFEST_BASENAMES.has(base)) manifestPaths.push(entry.path);
        // Capture every dir component along the file's path.
        const idx = entry.path.lastIndexOf('/');
        if (idx > 0) {
          for (const seg of entry.path.slice(0, idx).split('/')) {
            if (seg.length > 0) directories.add(seg);
          }
        }
      } else if (entry.type === 'tree') {
        const base = basenameOf(entry.path);
        if (base.length > 0) directories.add(base);
      }
    }
    return { manifestPaths, directories };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404 || status === 409) return empty;
    logger.debug(
      `git tree fetch failed for ${ref.owner}/${ref.repo}@${headSha.slice(0, 7)}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return empty;
  }
}

function writeInternalRoots(tempRoot: string, directories: Set<string>): void {
  if (directories.size === 0) return;
  const out = path.join(tempRoot, INTERNAL_ROOTS_FILENAME);
  fs.writeFileSync(out, [...directories].sort().join('\n') + '\n');
}

interface ContentsResponseFile {
  type: string;
  content?: string;
  encoding?: string;
}

async function fetchFileContent(
  octokit: Octokit,
  ref: GithubPrRef,
  repoPath: string,
  sha: string,
): Promise<string | undefined> {
  try {
    const response = await octokit.repos.getContent({
      owner: ref.owner,
      repo: ref.repo,
      path: repoPath,
      ref: sha,
    });
    const data = response.data as unknown;
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined;
    const file = data as ContentsResponseFile;
    if (file.type !== 'file' || typeof file.content !== 'string') return undefined;
    const enc = file.encoding ?? 'base64';
    if (enc === 'base64') {
      return Buffer.from(file.content, 'base64').toString('utf8');
    }
    return file.content;
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404) return undefined;
    logger.debug(
      `manifest fetch failed for ${repoPath} @ ${sha.slice(0, 7)}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return undefined;
  }
}

function basenameOf(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx < 0 ? p : p.slice(idx + 1);
}

// Re-exported only so consumers without their own SwarmError dep can
// surface a consistent error if they want to hard-fail on no manifests.
export { SwarmError };
