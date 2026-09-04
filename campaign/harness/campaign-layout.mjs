/**
 * Where a campaign's own files live. The selection, the seeds, the criteria, the images and
 * the work directory are shared by every campaign run from this tree, because a second
 * campaign measures a different CLI against the same seeds; what differs per campaign is
 * the results and the corpus, and those are never written into another campaign's
 * directories. The unnamed campaign is the one of 2026-09-02 at `results/` and `corpus/`;
 * a named one lives under `campaigns/<name>/`.
 */
import { join } from "node:path";

export const campaignNamePattern = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function campaignDirectories(campaignRoot, name = null) {
  if (name === null) {
    const results = join(campaignRoot, "results");
    return {
      name: null,
      root: campaignRoot,
      results,
      corpus: join(campaignRoot, "corpus"),
      report: join(results, "report.md"),
      cliRecord: join(results, "cli.json"),
    };
  }
  if (typeof name !== "string" || !campaignNamePattern.test(name)) {
    throw new Error(
      `a campaign name is lower-case letters, digits and hyphens, starting with a letter or digit, at most forty characters: ${JSON.stringify(name)}`,
    );
  }
  const root = join(campaignRoot, "campaigns", name);
  const results = join(root, "results");
  return {
    name,
    root,
    results,
    corpus: join(root, "corpus"),
    report: join(results, "report.md"),
    cliRecord: join(results, "cli.json"),
  };
}
