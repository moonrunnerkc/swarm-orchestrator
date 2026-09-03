import { describe, expect, it } from "vitest";
import { candidateFrom, orderCandidates, supersedable, walkCandidates } from "./candidates.mjs";

function candidate(fullName, stars, language = "Go") {
  return { fullName, stars, language };
}

describe("reading a search item", () => {
  it("keeps the fields the rules read and nothing else", () => {
    const read = candidateFrom({
      full_name: "someone/thing",
      owner: { login: "someone" },
      language: "Rust",
      stargazers_count: 512,
      license: { spdx_id: "MIT" },
      default_branch: "main",
      size: 1024,
      archived: false,
      fork: false,
      is_template: true,
      mirror_url: null,
      pushed_at: "2026-05-01T00:00:00Z",
      clone_url: "https://github.com/someone/thing.git",
      description: "not kept",
    });

    expect(read).toEqual({
      fullName: "someone/thing",
      owner: "someone",
      language: "Rust",
      stars: 512,
      license: "MIT",
      defaultBranch: "main",
      sizeKilobytes: 1024,
      archived: false,
      fork: false,
      template: true,
      mirror: false,
      pushedAt: "2026-05-01T00:00:00Z",
      cloneUrl: "https://github.com/someone/thing.git",
    });
  });

  it("reads a missing license as null rather than as a string", () => {
    expect(candidateFrom({ full_name: "a/b", stargazers_count: 1, license: null }).license).toBeNull();
  });
});

describe("ordering candidates", () => {
  it("sorts by stars descending, then full name ascending", () => {
    const ordered = orderCandidates([
      candidate("b/second", 300),
      candidate("a/third", 100),
      candidate("c/first", 300),
      candidate("d/last", 100),
    ]);

    expect(ordered.map((entry) => entry.fullName)).toEqual([
      "b/second",
      "c/first",
      "a/third",
      "d/last",
    ]);
  });

  it("keeps one entry per repository across the license queries", () => {
    const ordered = orderCandidates([
      candidate("a/one", 10),
      candidate("a/one", 10),
      candidate("a/two", 5),
    ]);

    expect(ordered).toHaveLength(2);
  });
});

describe("walking the candidates", () => {
  const pool = {
    Go: [candidate("g/1", 9), candidate("g/2", 8), candidate("g/3", 7)],
    Rust: [candidate("r/1", 9, "Rust")],
  };

  it("takes candidates in order until each quota is met, recording every decision", async () => {
    const judge = async (entry) =>
      entry.fullName === "g/1" ? { accepted: false, reason: "size" } : { accepted: true };

    const walk = await walkCandidates(pool, judge, { quotas: { Go: 2, Rust: 1 } });

    expect(walk.accepted.map((entry) => entry.fullName)).toEqual(["g/2", "g/3", "r/1"]);
    expect(walk.decisions).toEqual([
      { fullName: "g/1", language: "Go", accepted: false, reason: "size" },
      { fullName: "g/2", language: "Go", accepted: true },
      { fullName: "g/3", language: "Go", accepted: true },
      { fullName: "r/1", language: "Rust", accepted: true },
    ]);
    expect(walk.shortfalls).toEqual({});
  });

  it("stops asking once a quota is met, so nothing past it is judged", async () => {
    const asked = [];
    const judge = async (entry) => {
      asked.push(entry.fullName);
      return { accepted: true };
    };

    await walkCandidates(pool, judge, { quotas: { Go: 1, Rust: 1 } });

    expect(asked).toEqual(["g/1", "r/1"]);
  });

  it("reports a shortfall by language rather than filling it from another", async () => {
    const judge = async () => ({ accepted: true });

    const walk = await walkCandidates(pool, judge, { quotas: { Go: 5, Rust: 1 } });

    expect(walk.accepted).toHaveLength(4);
    expect(walk.shortfalls).toEqual({ Go: 2 });
  });
});

describe("which decisions a later judgement may supersede", () => {
  it("names the standing rejections with the reason, in the order recorded, and nothing accepted", () => {
    const decisions = [
      { fullName: "a/1", accepted: false, reason: "install failed: go mod download (exit 1)" },
      { fullName: "a/2", accepted: true },
      { fullName: "a/3", accepted: false, reason: "lines: 40000" },
      { fullName: "a/4", accepted: false, reason: "install failed: go mod download (exit 1)" },
      { fullName: "a/1", accepted: true },
    ];

    expect(supersedable(decisions, "install failed: go mod download").map((entry) => entry.fullName)).toEqual(["a/4"]);
  });
});
