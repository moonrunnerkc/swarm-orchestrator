/**
 * The search step: one query per language and license keyword, every page, results saved
 * raw so the walk can be reproduced from what was seen. The request is made through `gh`
 * with the invocation injected, so the pure parts, which queries and which pages, are what
 * the test covers.
 */
import { licenses, quotas, search, searchQuery } from "./criteria.mjs";

/** How many results one language needs before its walk can be expected to fill the quota. */
export function pagesFor() {
  return 3;
}

export function queriesFor() {
  const queries = [];
  for (const language of Object.keys(quotas)) {
    for (const keyword of Object.values(licenses)) {
      queries.push({ language, keyword, query: searchQuery(language, keyword) });
    }
  }
  return queries;
}

export function searchArgv({ query, page }) {
  return [
    "api",
    "--method",
    "GET",
    "/search/repositories",
    "--field",
    `q=${query}`,
    "--field",
    `sort=${search.sort}`,
    "--field",
    `order=${search.order}`,
    "--field",
    `per_page=${search.pageSize}`,
    "--field",
    `page=${page}`,
  ];
}

/**
 * Runs every query through `runGh(argv) -> parsed json`, returning the raw items tagged with
 * the query that found them and the time they were fetched.
 */
export async function fetchCandidates(runGh, now) {
  const fetched = [];
  for (const entry of queriesFor()) {
    for (let page = 1; page <= pagesFor(); page += 1) {
      const response = await runGh(searchArgv({ query: entry.query, page }));
      const items = response.items ?? [];
      for (const item of items) {
        fetched.push({ ...item, campaignQuery: entry.query, fetchedAt: now() });
      }
      if (items.length < search.pageSize) {
        break;
      }
    }
  }
  return fetched;
}
