import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { defaultPricingUrl } from "./pricing-source.ts";
import { publishedFileUrl, publishedRef } from "./published-source.ts";
import { defaultShortlistUrl } from "./shortlist-source.ts";

const repositoryRoot = new URL("../../", import.meta.url);

function pathInTree(url: string): string {
  const prefix = `https://raw.githubusercontent.com/moonrunnerkc/swarm-orchestrator/${publishedRef}/`;
  expect(url.startsWith(prefix)).toBe(true);
  return url.slice(prefix.length);
}

describe("publishedFileUrl", () => {
  it("serves both curated files from one ref, so the two cannot drift apart", () => {
    expect(pathInTree(defaultShortlistUrl)).toBe("src/select/coding-models.v1.json");
    expect(pathInTree(defaultPricingUrl)).toBe("src/select/model-pricing.v1.json");
  });

  // Offline, so it checks the path rather than the ref: a URL naming a file this tree does not
  // hold cannot be served from any ref of it. Whether the ref itself is live is a network check
  // and belongs in the weekly scan.
  it("names files that exist in this tree", async () => {
    for (const url of [defaultShortlistUrl, defaultPricingUrl]) {
      await expect(access(new URL(pathInTree(url), repositoryRoot))).resolves.toBeUndefined();
    }
  });

  it("builds a raw URL under the published ref", () => {
    expect(publishedFileUrl("src/select/coding-models.v1.json")).toBe(defaultShortlistUrl);
  });
});
