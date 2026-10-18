/**
 * The version this build reports, read from the package manifest at build time rather than kept
 * as a second copy here: a hand-maintained constant beside a manifest is a constant that goes
 * stale on the release that matters.
 */
import { createRequire } from "node:module";

const manifest = createRequire(import.meta.url)("../package.json") as { version?: string };

export const buildVersion = manifest.version ?? "0.0.0-unknown";

/**
 * The version a person is shown: the manifest's, and where this build is not that release (a
 * build of source ahead of it, or with uncommitted changes), what it is instead. A source build
 * and the release reported the same "14.4.0" while behaving differently.
 */
export function describeRunningVersion(version: string, describe: string | null): string {
  return describe === null || describe === `v${version}`
    ? version
    : `${version} (source build ${describe}, not the ${version} release)`;
}
