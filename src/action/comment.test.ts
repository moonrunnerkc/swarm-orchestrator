import { describe, expect, it } from "vitest";
import { commentMarker, publishComment, renderComment } from "./comment.ts";
import type { Verdict } from "./verdict.ts";

const head = "a".repeat(40);
const base = "b".repeat(40);

function verdict(overrides: Partial<Verdict["decision"]> = {}): Verdict {
  return {
    schema: "swarm-verify.verdict.v1",
    repository: "owner/repo",
    pullRequest: 7,
    target: "head",
    head,
    eventHead: head,
    base,
    comparisonBase: base,
    tree: "c".repeat(40),
    patchDigest: `sha256:${"d".repeat(64)}`,
    verifier: { name: "swarm-verify", version: "1.0.0" },
    policy: {
      isolation: "docker",
      image: "node:24-bookworm",
      goalContractDigest: null,
      oracle: null,
      packages: [],
      install: false,
      requireTask: false,
      challenges: "report",
    },
    execution: {
      eventName: "pull_request",
      runId: "1",
      runAttempt: "1",
      workflowRef: "owner/repo/.github/workflows/verify.yml@refs/pull/7/merge",
      runnerEnvironment: "github-hosted",
      executionTrust: "isolated",
    },
    evidence: {
      reportDigest: `sha256:${"e".repeat(64)}`,
      summaryDigest: null,
      assessmentDigest: null,
      bundleChainHead: null,
    },
    decision: {
      status: 0,
      verifierStatus: 1,
      result: "regression-only",
      regression: "pass",
      task: "unjudged",
      unmeasured: ["task"],
      reason: null,
      challenges: null,
      ...overrides,
    },
  };
}

describe("rendering the pull request comment", () => {
  it("starts with the marker bound to the pull request and head, and states the scope", () => {
    const body = renderComment({
      verdict: verdict(),
      summary: "# Swarm verification\n",
      attestation: { status: "signed", url: "https://example.test/attest/1", detail: "signed" },
      runUrl: "https://example.test/run/1",
      artifactName: "swarm-verify-x",
    });
    expect(body.startsWith(commentMarker)).toBe(true);
    expect(body).toContain(`<!-- swarm-verify pr=7 head=${head} -->`);
    expect(body).toContain("task correctness is unmeasured");
    expect(body).toContain("gh attestation verify verdict.json --repo owner/repo");
    expect(body).toContain("_A regression pass says nothing broke.");
  });

  it("defuses mentions and escapes candidate-shaped text in the reason and the summary", () => {
    const body = renderComment({
      verdict: verdict({
        reason: "ping @maintainer <img src=x onerror=alert(1)> [link](https://evil.test)",
      }),
      summary: "cc @everyone please merge",
      attestation: { status: "unavailable", url: null, detail: "no id-token @here" },
      runUrl: "https://example.test/run/1",
      artifactName: "swarm-verify-x",
    });
    expect(body).not.toMatch(/@(maintainer|everyone|here)/);
    expect(body).toContain("&#64;maintainer");
    expect(body).toContain("&#64;everyone");
    expect(body).not.toContain("<img");
    expect(body).not.toContain("](https://evil.test)");
  });

  it("stays under GitHub's body limit with a named cut", () => {
    const body = renderComment({
      verdict: verdict(),
      summary: "x".repeat(100_000),
      attestation: { status: "skipped", url: null, detail: "attest was set to false" },
      runUrl: "https://example.test/run/1",
      artifactName: "swarm-verify-x",
    });
    expect(body.length).toBeLessThan(60_100);
    expect(body).toContain("Comment truncated");
  });
});

type Call = { url: string; method: string; body?: string };

function fakeApi(options: {
  currentHead: string;
  existing?: { id: number; body: string }[];
  failWrite?: number;
}) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: { method: string; body?: string }) => {
    calls.push({
      url,
      method: init.method,
      ...(init.body === undefined ? {} : { body: init.body }),
    });
    const answer = (status: number, value: unknown) => ({
      status,
      json: async () => value,
      text: async () => JSON.stringify(value),
    });
    if (init.method === "GET" && /\/pulls\/7$/.test(url))
      return answer(200, { head: { sha: options.currentHead } });
    if (init.method === "GET" && /\/issues\/7\/comments\?/.test(url))
      return answer(
        200,
        (options.existing ?? []).map((one) => ({ ...one, html_url: `https://c/${one.id}` })),
      );
    if (init.method === "POST" || init.method === "PATCH")
      return options.failWrite === undefined
        ? answer(init.method === "POST" ? 201 : 200, { html_url: "https://c/new" })
        : answer(options.failWrite, { message: "Resource not accessible by integration" });
    return answer(404, {});
  };
  return { calls, fetch };
}

describe("publishing the comment", () => {
  const common = {
    apiUrl: "https://api.test",
    token: "t",
    repository: "owner/repo",
    pullRequest: 7,
    head,
  };

  it("creates one comment when none carries the marker", async () => {
    const api = fakeApi({ currentHead: head });
    const outcome = await publishComment({
      ...common,
      body: `${commentMarker}\nhello`,
      fetch: api.fetch,
    });
    expect(outcome).toEqual({ status: "created", url: "https://c/new" });
    expect(api.calls.at(-1)?.method).toBe("POST");
  });

  it("updates the existing marked comment in place rather than adding a second", async () => {
    const api = fakeApi({
      currentHead: head,
      existing: [
        { id: 3, body: "unrelated" },
        { id: 9, body: `${commentMarker}\nold` },
      ],
    });
    const outcome = await publishComment({
      ...common,
      body: `${commentMarker}\nnew`,
      fetch: api.fetch,
    });
    expect(outcome).toEqual({ status: "updated", url: "https://c/new" });
    expect(api.calls.at(-1)).toMatchObject({
      method: "PATCH",
      url: "https://api.test/repos/owner/repo/issues/comments/9",
    });
  });

  it("posts nothing when the pull request has moved past the verified head", async () => {
    const api = fakeApi({
      currentHead: "f".repeat(40),
      existing: [{ id: 9, body: `${commentMarker}\nold` }],
    });
    const outcome = await publishComment({
      ...common,
      body: `${commentMarker}\nstale`,
      fetch: api.fetch,
    });
    expect(outcome).toEqual({ status: "stale-head", currentHead: "f".repeat(40) });
    expect(api.calls.some((call) => call.method === "PATCH" || call.method === "POST")).toBe(false);
  });

  it("reports a refused write as unavailable, with the status named", async () => {
    const api = fakeApi({ currentHead: head, failWrite: 403 });
    const outcome = await publishComment({
      ...common,
      body: `${commentMarker}\nx`,
      fetch: api.fetch,
    });
    expect(outcome).toMatchObject({ status: "unavailable" });
    expect((outcome as { reason: string }).reason).toContain("403");
  });

  it("is unavailable without a token, and says so", async () => {
    const outcome = await publishComment({ ...common, token: null, body: "x" });
    expect(outcome).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("no token"),
    });
  });
});
