import { describe, expect, it } from "vitest";
import { fetchCandidates, queriesFor, searchArgv } from "./github-search.mjs";

describe("the search queries", () => {
  it("cover every language and every license keyword, once each", () => {
    const queries = queriesFor();

    expect(queries).toHaveLength(5 * 7);
    expect(queries[0]).toEqual({
      language: "JavaScript",
      keyword: "mit",
      query: "language:JavaScript license:mit stars:>=200 pushed:>=2025-01-01 archived:false fork:false",
    });
    expect(new Set(queries.map((entry) => entry.query)).size).toBe(35);
  });

  it("asks the search endpoint by stars descending, a full page at a time", () => {
    expect(searchArgv({ query: "language:Go", page: 2 })).toEqual([
      "api",
      "--method",
      "GET",
      "/search/repositories",
      "--field",
      "q=language:Go",
      "--field",
      "sort=stars",
      "--field",
      "order=desc",
      "--field",
      "per_page=100",
      "--field",
      "page=2",
    ]);
  });
});

describe("fetching candidates", () => {
  it("reads pages until a short one, and tags each item with its query and time", async () => {
    const calls = [];
    const runGh = async (argv) => {
      calls.push(argv);
      const page = Number(argv.at(-1).replace("page=", ""));
      const full = Array.from({ length: 100 }, (_, index) => ({ full_name: `x/${page}-${index}` }));
      return { items: page === 1 ? full : [{ full_name: "x/last" }] };
    };

    const fetched = await fetchCandidates(runGh, () => "2026-09-02T00:00:00Z");

    expect(calls).toHaveLength(35 * 2);
    expect(fetched).toHaveLength(35 * 101);
    expect(fetched[0].campaignQuery).toContain("language:JavaScript license:mit");
    expect(fetched[0].fetchedAt).toBe("2026-09-02T00:00:00Z");
  });
});
