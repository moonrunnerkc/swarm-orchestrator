/**
 * The acceptance rules, in the order the criteria apply them. A candidate is rejected by the
 * first rule it fails, and the reason names that rule and nothing after it, so a rejection
 * record reads as one fact rather than as a list of everything wrong with the repository.
 */
import {
  excludedOwners,
  licenses,
  lines,
  manifests,
  quotas,
  repositorySizeMaximumKilobytes,
} from "./criteria.mjs";

/** GitHub's primary-language name to the manifest type the harness detects. */
export const projectTypeByLanguage = Object.freeze({
  JavaScript: "node",
  TypeScript: "node",
  Python: "python",
  Go: "go",
  Rust: "rust",
});

/**
 * The rules that need only what the search returned. Cheap, so they run before anything is
 * cloned, and a candidate they reject costs the walk one metadata read.
 */
export function rejectionFromSearch(candidate) {
  if (candidate.archived) return "archived";
  if (candidate.fork) return "fork";
  if (candidate.template) return "template";
  if (candidate.mirror) return "mirror";
  if (excludedOwners.includes(candidate.owner)) return `owner excluded: ${candidate.owner}`;
  if (!(candidate.language in quotas)) return `language outside the quotas: ${candidate.language}`;
  if (candidate.license === null || !(candidate.license in licenses)) {
    return `license: ${candidate.license ?? "none reported"}`;
  }
  if (candidate.sizeKilobytes > repositorySizeMaximumKilobytes) {
    return `repository size: ${candidate.sizeKilobytes} kilobytes`;
  }
  return null;
}

/** The rules that need the checkout: manifests, scripts, lockfiles, markers, and the count. */
export function rejectionFromCheckout(candidate, facts, lineCount) {
  const type = projectTypeByLanguage[candidate.language];
  if (facts.configuresHarness) return "carries swarm.toml";
  if (facts.workspace.length > 0) return `multi-package tree: ${facts.workspace[0]}`;
  if (facts.serviceDependencies.length > 0) {
    return `needs a service: ${facts.serviceDependencies[0]}`;
  }
  if (!facts.types.includes(type)) return `no ${manifests[type]}`;
  if (type === "node") {
    if (facts.testScript === null) return "no test script";
    if (facts.placeholderTest) return "placeholder test script";
    if (facts.lockfile === null) return "no lockfile the install recipe covers";
  }
  if (lineCount < lines.minimum || lineCount > lines.maximum) {
    return `lines: ${lineCount}`;
  }
  return null;
}
