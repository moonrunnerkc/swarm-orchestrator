// Shared types for manifest readers used by the mock-of-hallucination
// detector. Each reader exports `readDependencies(repoRoot)` returning
// the set of dependency names declared by that ecosystem's manifest
// file(s). `collectKnownDependencies(repoRoot)` in this module's
// `index.ts` fans out to every registered reader.
//
// The contract for every reader:
//   - Silent absence: the manifest file is missing → return an empty set
//     and do not throw. The detector's call site only ever asks "is X
//     in any manifest?", and absent manifests can't answer that.
//   - Parse failure: throw `SwarmError` with a `remediation` hint. A
//     corrupt manifest is a real problem the user needs to fix.
//   - Pure read: no installs, no network, no shelling out.

export type ManifestReader = (repoRoot: string) => Set<string>;
