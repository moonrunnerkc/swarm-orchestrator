/**
 * The `.pre-commit-hooks.yaml` the Action distribution carries, for one published version.
 *
 * The hook runs the pinned verifier through npx rather than as a `node` language hook. The
 * framework's node route installs the distribution repository from git, which npm 11 refuses
 * (EALLOWGIT), and a global install of that wrapper links no `swarm-verify` bin, so the hook ran
 * whichever binary happened to be on PATH, or none.
 */
export function preCommitHooksManifest(version) {
  return [
    "- id: swarm-verify",
    "  name: swarm-verify (staged tree)",
    "  description: Verify the staged tree with swarm-verify before the commit; the working tree is never touched.",
    `  entry: npx --yes swarm-verify@${version} pre-commit`,
    "  language: system",
    "  pass_filenames: false",
    "  always_run: true",
    "  stages: [pre-commit]",
    "",
  ].join("\n");
}
