/**
 * The version this build reports, read from the package manifest at build time rather than kept
 * as a second copy here: a hand-maintained constant beside a manifest is a constant that goes
 * stale on the release that matters.
 */
import { createRequire } from "node:module";

const manifest = createRequire(import.meta.url)("../package.json") as { version?: string };

export const buildVersion = manifest.version ?? "0.0.0-unknown";
