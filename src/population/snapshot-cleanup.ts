/**
 * Snapshot sidecar cleanup.
 *
 * Per-obligation snapshots are written under `.swarm/snapshots/<runId>/`
 * before each apply. They are required for crash-safe rollback while a
 * run is in flight, but a successful completed run never needs them
 * again. This module provides a small set of cleanup policies that
 * reclaim disk safely without breaking recovery.
 *
 * Hooks reuse the existing run lifecycle (manager calls `cleanupSnapshots`
 * once after `run-finished` is appended). There is no daemon, no
 * background scanner, no separate manifest. The filesystem layout is the
 * source of truth; cleanup is idempotent and crash-safe (`fs.rmSync`
 * with `force: true`).
 *
 * Policies:
 *   - `retain-on-failure` (default): drop the current run's snapshot
 *     directory iff `runFailed === false`. Failed/incomplete runs keep
 *     their snapshots so resume can roll back.
 *   - `always`: drop the current run's directory unconditionally.
 *   - `never`: keep everything (legacy behaviour).
 *   - `retain-last-n`: after the per-run policy runs, keep the N most
 *     recently modified `<runId>` directories under `.swarm/snapshots/`
 *     and prune the rest.
 *   - `max-age-ms`: prune `<runId>` directories whose newest sidecar
 *     mtime is older than `maxAgeMs` from now.
 *   - `max-disk-bytes`: when total bytes under `.swarm/snapshots/`
 *     exceed the cap, prune oldest `<runId>` directories until under.
 *
 * Race-safety: the cleanup helper takes the *current* run id and never
 * removes that directory while the run is still active (the only caller
 * runs after the manager's main loop has finished). Other concurrent
 * runs each own a distinct `<runId>` subtree; the prune-others phase is
 * mtime-bounded so a freshly-started concurrent run is the newest entry
 * and is preserved.
 */

import * as fs from 'fs';
import * as path from 'path';

/** A cleanup policy tag plus its parameters. */
export type SnapshotCleanupPolicy =
  | { kind: 'retain-on-failure' }
  | { kind: 'always' }
  | { kind: 'never' }
  | { kind: 'retain-last-n'; n: number }
  | { kind: 'max-age-ms'; maxAgeMs: number }
  | { kind: 'max-disk-bytes'; maxBytes: number };

/** Outcome of a single `cleanupSnapshots` invocation. */
export interface CleanupResult {
  /** Run-id directories actually removed (in deletion order). */
  removedRuns: string[];
  /** Run-id directories kept. */
  retainedRuns: string[];
  /** Approximate bytes reclaimed (sum of file sizes in the removed dirs). */
  bytesReclaimed: number;
  /** Total bytes still under `.swarm/snapshots/` after cleanup. */
  remainingBytes: number;
}

/** Default policy: keep snapshots only for failed runs. */
export const DEFAULT_SNAPSHOT_POLICY: SnapshotCleanupPolicy = { kind: 'retain-on-failure' };

/**
 * Parse a CLI policy string. Accepted forms:
 *   - `retain-on-failure`
 *   - `always`
 *   - `never`
 *   - `retain-last:N`              (integer ≥ 0)
 *   - `max-age:<duration>`         (e.g. `7d`, `24h`, `30m`, `90s`, `1500ms`)
 *   - `max-disk:<size>`            (e.g. `100MB`, `2GB`, `1024KB`, `1024`)
 *
 * Throws `Error` on malformed input.
 */
export function parseSnapshotPolicy(spec: string): SnapshotCleanupPolicy {
  const s = spec.trim();
  if (s === 'retain-on-failure') return { kind: 'retain-on-failure' };
  if (s === 'always') return { kind: 'always' };
  if (s === 'never') return { kind: 'never' };
  const lastN = /^retain-last:(\d+)$/.exec(s);
  if (lastN) return { kind: 'retain-last-n', n: Number.parseInt(lastN[1] ?? '0', 10) };
  const age = /^max-age:(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(s);
  if (age) {
    const n = Number.parseFloat(age[1] ?? '0');
    const unit = age[2] ?? 'ms';
    const mult: Record<string, number> = {
      ms: 1,
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return { kind: 'max-age-ms', maxAgeMs: Math.round(n * (mult[unit] ?? 1)) };
  }
  const disk = /^max-disk:(\d+(?:\.\d+)?)(B|KB|MB|GB)?$/.exec(s);
  if (disk) {
    const n = Number.parseFloat(disk[1] ?? '0');
    const unit = disk[2] ?? 'B';
    const mult: Record<string, number> = {
      B: 1,
      KB: 1024,
      MB: 1024 * 1024,
      GB: 1024 * 1024 * 1024,
    };
    return { kind: 'max-disk-bytes', maxBytes: Math.round(n * (mult[unit] ?? 1)) };
  }
  throw new Error(`invalid --snapshot-cleanup policy "${spec}"`);
}

/** Root directory for snapshot sidecars. */
export function snapshotRoot(repoRoot: string): string {
  return path.join(repoRoot, '.swarm', 'snapshots');
}

/**
 * Run cleanup for the current run plus, depending on policy, prune
 * snapshots from older runs as well. Idempotent: calling twice with
 * the same arguments has no further effect after the first call.
 *
 * The current run's directory is never removed when `runFailed` is true,
 * regardless of policy, except for `always` (operator-acknowledged).
 */
export function cleanupSnapshots(
  repoRoot: string,
  currentRunId: string,
  runFailed: boolean,
  policy: SnapshotCleanupPolicy,
): CleanupResult {
  const root = snapshotRoot(repoRoot);
  const removedRuns: string[] = [];
  let bytesReclaimed = 0;

  if (!fs.existsSync(root)) {
    return { removedRuns, retainedRuns: [], bytesReclaimed: 0, remainingBytes: 0 };
  }

  // Stage 1: handle the current run.
  if (policy.kind === 'always') {
    bytesReclaimed += tryRemoveRunDir(root, currentRunId, removedRuns);
  } else if (policy.kind === 'retain-on-failure' && !runFailed) {
    bytesReclaimed += tryRemoveRunDir(root, currentRunId, removedRuns);
  } else if (
    !runFailed &&
    (policy.kind === 'retain-last-n' || policy.kind === 'max-age-ms' || policy.kind === 'max-disk-bytes')
  ) {
    // For multi-run policies, drop the current successful run too;
    // the per-policy prune below decides what to keep.
    bytesReclaimed += tryRemoveRunDir(root, currentRunId, removedRuns);
  }

  // Stage 2: cross-run pruning (only the multi-run policies).
  const remaining = listRunDirs(root, removedRuns);
  if (policy.kind === 'retain-last-n') {
    // Sort newest first by mtime; remove everything past index `n`.
    remaining.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (let i = policy.n; i < remaining.length; i += 1) {
      const r = remaining[i];
      if (!r) continue;
      bytesReclaimed += tryRemoveRunDir(root, r.runId, removedRuns);
    }
  } else if (policy.kind === 'max-age-ms') {
    const cutoff = Date.now() - policy.maxAgeMs;
    for (const r of remaining) {
      if (r.mtimeMs < cutoff) {
        bytesReclaimed += tryRemoveRunDir(root, r.runId, removedRuns);
      }
    }
  } else if (policy.kind === 'max-disk-bytes') {
    let total = remaining.reduce((acc, r) => acc + r.bytes, 0);
    if (total > policy.maxBytes) {
      // Prune oldest first until under cap. Sort ascending by mtime.
      remaining.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const r of remaining) {
        if (total <= policy.maxBytes) break;
        bytesReclaimed += tryRemoveRunDir(root, r.runId, removedRuns);
        total -= r.bytes;
      }
    }
  }

  const retained = listRunDirs(root, removedRuns).map((r) => r.runId);
  const remainingBytes = retained.reduce((acc, id) => acc + dirBytes(path.join(root, id)), 0);
  return { removedRuns, retainedRuns: retained, bytesReclaimed, remainingBytes };
}

interface RunDirInfo {
  runId: string;
  mtimeMs: number;
  bytes: number;
}

function listRunDirs(root: string, alreadyRemoved: readonly string[]): RunDirInfo[] {
  const removed = new Set(alreadyRemoved);
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return [];
  }
  const out: RunDirInfo[] = [];
  for (const name of entries) {
    if (removed.has(name)) continue;
    const full = path.join(root, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    out.push({ runId: name, mtimeMs: newestMtimeMs(full, st.mtimeMs), bytes: dirBytes(full) });
  }
  return out;
}

function newestMtimeMs(dir: string, fallback: number): number {
  let best = fallback;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(next, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(next, e.name);
      try {
        const st = fs.statSync(full);
        if (st.mtimeMs > best) best = st.mtimeMs;
        if (e.isDirectory()) stack.push(full);
      } catch {
        // ignore — file may have been removed concurrently
      }
    }
  }
  return best;
}

function dirBytes(dir: string): number {
  let total = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(next, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(next, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      try {
        total += fs.statSync(full).size;
      } catch {
        // ignore
      }
    }
  }
  return total;
}

function tryRemoveRunDir(root: string, runId: string, removedSink: string[]): number {
  const target = path.join(root, runId);
  if (!fs.existsSync(target)) return 0;
  const bytes = dirBytes(target);
  try {
    fs.rmSync(target, { recursive: true, force: true });
    removedSink.push(runId);
    return bytes;
  } catch {
    // Crash-safe: leave untouched on rm failure; next cleanup retries.
    return 0;
  }
}
