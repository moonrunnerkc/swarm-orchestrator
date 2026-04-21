import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { VerificationCheck } from '../verifier-engine';

export type MigrationBackend = 'sqlite' | 'postgres';

export interface SchemaEvolutionOpts {
  workdir: string;
  backend: MigrationBackend;
  /** Pre-migration schema SQL (applied before the migration under test). */
  seedSchema: string;
  /** Path to the migration SQL file, relative to workdir. */
  migrationFile: string;
  /** SQL executed after the migration; must succeed for the check to pass. */
  probeQuery: string;
  /** Postgres image override; ignored for sqlite backend. */
  postgresImage?: string;
}

/**
 * Apply a migration against a freshly-seeded database and run a probe query.
 * Pass when the migration applies cleanly AND the probe returns without error.
 * Fail otherwise, surfacing the real stderr from the database engine.
 *
 * The SQLite backend shells out to the system `sqlite3` CLI against an
 * ephemeral temp-file DB. The Postgres backend spins up a disposable Docker
 * container (image defaults to `postgres:15-alpine`), waits for readiness, and
 * runs migration + probe via `psql` inside the container.
 *
 * @throws never; all failure modes are returned as a failing VerificationCheck
 */
export function checkSchemaEvolution(opts: SchemaEvolutionOpts): VerificationCheck {
  const migrationPath = path.resolve(opts.workdir, opts.migrationFile);
  if (!fs.existsSync(migrationPath)) {
    return {
      type: 'schema_evolution',
      description: 'Migration applies cleanly and probe query succeeds',
      required: true,
      passed: false,
      reason: `Migration file not found: ${opts.migrationFile}`,
    };
  }

  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  if (opts.backend === 'sqlite') {
    return runSqlite(opts.seedSchema, migrationSql, opts.probeQuery);
  }
  return runPostgres(
    opts.seedSchema,
    migrationSql,
    opts.probeQuery,
    opts.postgresImage ?? 'postgres:15-alpine',
  );
}

function runSqlite(seed: string, migration: string, probe: string): VerificationCheck {
  const dbFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'schema-evo-')),
    'check.db',
  );

  try {
    applySqlite(dbFile, seed, 'seed');
    applySqlite(dbFile, migration, 'migration');
    const probeOutput = applySqlite(dbFile, probe, 'probe');

    return {
      type: 'schema_evolution',
      description: 'Migration applies cleanly and probe query succeeds',
      required: true,
      passed: true,
      evidence: probeOutput
        ? `probe output: ${probeOutput.slice(0, 200)}`
        : 'probe ran without error',
    };
  } catch (err: unknown) {
    const e = err as { phase?: string; message?: string };
    return {
      type: 'schema_evolution',
      description: 'Migration applies cleanly and probe query succeeds',
      required: true,
      passed: false,
      reason: `${e.phase ?? 'unknown-phase'} failed: ${e.message ?? String(err)}`,
    };
  } finally {
    try {
      fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
    } catch {
      // tempdir cleanup is best-effort
    }
  }
}

interface PhaseError extends Error {
  phase: string;
}

function phaseError(phase: string, message: string, cause?: unknown): PhaseError {
  const err = new Error(message, cause !== undefined ? { cause } : {}) as PhaseError;
  err.phase = phase;
  return err;
}

function applySqlite(dbFile: string, sql: string, phase: string): string {
  if (!sql.trim()) return '';
  try {
    return execFileSync('sqlite3', [dbFile], {
      input: sql,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15_000,
    });
  } catch (err: unknown) {
    const stderr = extractStderr(err);
    throw phaseError(phase, stderr || asMessage(err), err);
  }
}

function runPostgres(
  seed: string,
  migration: string,
  probe: string,
  image: string,
): VerificationCheck {
  if (!dockerAvailable()) {
    return {
      type: 'schema_evolution',
      description: 'Migration applies cleanly and probe query succeeds',
      required: true,
      passed: false,
      reason:
        'postgres backend requires Docker but `docker ps` failed. Install Docker or ' +
        'set backend: "sqlite" for SQLite projects.',
    };
  }

  const containerName = `schema-evo-${process.pid}-${Date.now()}`;
  try {
    execFileSync(
      'docker',
      [
        'run',
        '--rm',
        '-d',
        '--name',
        containerName,
        '-e',
        'POSTGRES_PASSWORD=swarm',
        '-e',
        'POSTGRES_DB=swarm_eval',
        image,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000 },
    );

    waitForPostgresReady(containerName);

    applyPsql(containerName, seed, 'seed');
    applyPsql(containerName, migration, 'migration');
    const probeOutput = applyPsql(containerName, probe, 'probe');

    return {
      type: 'schema_evolution',
      description: 'Migration applies cleanly and probe query succeeds',
      required: true,
      passed: true,
      evidence: probeOutput
        ? `probe output: ${probeOutput.slice(0, 200)}`
        : 'probe ran without error',
    };
  } catch (err: unknown) {
    const e = err as { phase?: string; message?: string };
    return {
      type: 'schema_evolution',
      description: 'Migration applies cleanly and probe query succeeds',
      required: true,
      passed: false,
      reason: `${e.phase ?? 'unknown-phase'} failed: ${e.message ?? String(err)}`,
    };
  } finally {
    try {
      execFileSync('docker', ['rm', '-f', containerName], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30_000,
      });
    } catch {
      // container may already be gone; tear-down is best-effort
    }
  }
}

function dockerAvailable(): boolean {
  try {
    execSync('docker ps', { stdio: ['pipe', 'pipe', 'pipe'], timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

function waitForPostgresReady(containerName: string): void {
  const start = Date.now();
  const timeoutMs = 30_000;
  while (Date.now() - start < timeoutMs) {
    try {
      execFileSync(
        'docker',
        ['exec', containerName, 'pg_isready', '-U', 'postgres'],
        { stdio: ['pipe', 'pipe', 'pipe'], timeout: 5_000 },
      );
      return;
    } catch {
      // pg_isready exits non-zero until the server accepts connections
    }
    sleepMs(500);
  }
  throw phaseError('bringup', `postgres not ready after ${timeoutMs}ms`);
}

function sleepMs(ms: number): void {
  execFileSync('sleep', [(ms / 1000).toString()], {
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: ms + 1000,
  });
}

function applyPsql(containerName: string, sql: string, phase: string): string {
  if (!sql.trim()) return '';
  try {
    return execFileSync(
      'docker',
      [
        'exec',
        '-i',
        containerName,
        'psql',
        '-U',
        'postgres',
        '-d',
        'swarm_eval',
        '-v',
        'ON_ERROR_STOP=1',
        '-q',
      ],
      {
        input: sql,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30_000,
      },
    );
  } catch (err: unknown) {
    const stderr = extractStderr(err);
    throw phaseError(phase, stderr || asMessage(err), err);
  }
}

function extractStderr(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { stderr?: Buffer | string; stdout?: Buffer | string };
    const out: string[] = [];
    if (e.stdout) out.push(typeof e.stdout === 'string' ? e.stdout : e.stdout.toString('utf8'));
    if (e.stderr) out.push(typeof e.stderr === 'string' ? e.stderr : e.stderr.toString('utf8'));
    return out.join('\n').trim();
  }
  return '';
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
