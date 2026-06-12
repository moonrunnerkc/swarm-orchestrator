// Shared utilities used by both `swarm v8 run` and `swarm v8 resume`.
//
// Both handlers grew in parallel and accumulated four identical helpers
// (buildSession, renderProjectContext, parseCandidates, writeResultFile)
// plus the project-context preamble constant. The copies were already
// drifting (the run-handler had an inline `require('fs')` in
// writeResultFile that the resume-handler avoided), and both files churn
// frequently. Pulling the helpers here gives them one home so the next
// change to session construction or result emission lands in one place.

import * as fs from 'fs';
import * as path from 'path';
import {
  buildSession as buildSessionFromFactory,
  type SessionProvider,
} from '../../session/factory';
import type { Session } from '../../session/types';
import type { LocalProviderFlagValues } from './local-provider-flags';
import { formatGrammarWarning, resolveGrammarForConsumer } from './grammar-resolve';

/** Static preamble for the cached project-context system block. */
export const DEFAULT_PROJECT_CONTEXT_PREAMBLE =
  'You are a persona inside the swarm-orchestrator v8 population. ' +
  'Multiple personas share this prefix; per-call instructions follow.';

/** The session-relevant subset of the run/resume flag sets. Keeping the
 *  input narrow means a future flag added to one handler does not force
 *  a signature churn in this module. */
export interface SessionBuildFlags {
  sessionKind: SessionProvider;
  model: string | null;
  apiKey: string | null;
  externalPatchesDir: string | null;
  externalPatchesQueue: string | null;
  externalPatchesStdin: boolean;
  externalPatchesTimeoutMs: number | null;
  local: LocalProviderFlagValues;
}

/**
 * Build a Session from the run/resume flag set. Resolves the local
 * grammar (writing a coercion warning to stderr when the local
 * provider is active), threads every local-provider field through to
 * the factory, and includes the optional persona→model map only when
 * the caller supplied one.
 */
export function buildSessionFromFlags(
  flags: SessionBuildFlags,
  projectContext: string,
): Session {
  const resolution = resolveGrammarForConsumer('session', flags.local.grammar);
  if (resolution.coercion && flags.sessionKind === 'local') {
    process.stderr.write(formatGrammarWarning(resolution.coercion) + '\n');
  }
  const opts: Parameters<typeof buildSessionFromFactory>[0] = {
    provider: flags.sessionKind,
    projectContext,
    apiKey: flags.apiKey,
    model: flags.model,
    externalPatchesDir: flags.externalPatchesDir,
    externalPatchesQueue: flags.externalPatchesQueue,
    externalPatchesStdin: flags.externalPatchesStdin,
    externalPatchesTimeoutMs: flags.externalPatchesTimeoutMs,
    localBackend: flags.local.backend,
    localBaseUrl: flags.local.baseUrl,
    localModel: flags.local.modelSession,
    localGrammar: resolution.effective,
    localSeed: flags.local.seed,
    localApiKey: flags.local.apiKey,
    localRequestTimeoutMs: flags.local.requestTimeoutMs,
    localMaxConcurrency: flags.local.maxConcurrency,
  };
  if (flags.local.personaModelMap) opts.localPersonaModelMap = flags.local.personaModelMap;
  return buildSessionFromFactory(opts);
}

/**
 * Build the static project-context prefix the session caches. Phase 2's
 * version is intentionally minimal (contract goal + repo root); later
 * phases extend it without changing the cached prefix's first few
 * lines, which keeps Anthropic's prompt-cache stable across phases.
 */
export function renderProjectContext(goal: string, repoRoot: string): string {
  return [
    DEFAULT_PROJECT_CONTEXT_PREAMBLE,
    '',
    `Repository root: ${repoRoot}`,
    `User goal: ${goal}`,
    '',
    'Persona-specific instructions follow this block.',
  ].join('\n');
}

/** Parse the `--candidates <n>` flag. Rejects non-positive integers and
 *  values above 8 so tournament rounds cannot blow up the prompt cache. */
export function parseCandidates(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 8) {
    throw new Error(`invalid --candidates "${raw}"; must be a positive integer ≤ 8`);
  }
  return n;
}

/** Write the JSON run result payload to `filePath`, creating parent
 *  directories as needed. Used by both `--result <path>` paths. */
export function writeResultFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}
