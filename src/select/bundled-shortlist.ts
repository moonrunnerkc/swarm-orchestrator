import { readFile } from "node:fs/promises";
import { parseShortlist, type Shortlist } from "./shortlist.ts";

export const bundledShortlistLocation = "the snapshot bundled with this release";

/**
 * The floor under the published list: the same JSON, read from beside this module, so a machine
 * with no network still gets a recommendation rather than an error. It goes through the same
 * parser as the fetched copy, so a bad snapshot cannot reach the recommender by a shorter path.
 */
export async function readBundledShortlist(): Promise<Shortlist> {
  const text = await readFile(new URL("./coding-models.v1.json", import.meta.url), "utf8");
  return parseShortlist(text, bundledShortlistLocation);
}
