import { describe, expect, it } from "vitest";
import type { BundleManifest } from "./bundle-manifest.ts";
import type { EvidenceDag, EvidenceNode } from "./dag.ts";
import type { RecordType } from "./ledger-record.ts";
import { renderReviewPage } from "./review-page.ts";

const manifest: BundleManifest = {
  bundleFormat: 1,
  ledgerSchemaVersion: 1,
  sessionId: "20260824T120000-abc123",
  exportedAt: Date.parse("2026-08-24T12:00:00.000Z"),
  recordCount: 4,
  chainHead: `sha256:${"a".repeat(64)}`,
  signature: {
    algorithm: "ed25519",
    publicKey: "key",
    value: "sig",
    keySource: "ephemeral",
  },
  blobs: [],
  missingBlobs: [],
  claims: { verified: 0, unverified: 0 },
  workers: [],
};

function node(sequence: number, type: RecordType, payload: unknown): EvidenceNode {
  return {
    sequence,
    type,
    actor: "harness",
    timestamp: Date.parse("2026-08-24T12:00:00.000Z"),
    digest: `sha256:${String(sequence).padStart(64, "0")}`,
    provenance: [],
    summary: type,
    payload: payload as EvidenceNode["payload"],
  };
}

function dagOf(evidence: readonly EvidenceNode[]): EvidenceDag {
  return { claims: [], edges: [], evidence, verifiedCount: 0, unverifiedCount: 0 };
}

describe("what the page tells a person before it tells them a chain head", () => {
  /**
   * The header used to open with the session id and the chain head, and carried neither the
   * task, the model, nor whether the run worked. Those are the first questions anybody has,
   * all three were already in the ledger, and none of them was on the page.
   */
  it("names the task, the model and how the run ended", () => {
    const html = renderReviewPage(
      manifest,
      dagOf([
        node(0, "session-started", { task: "make divide throw on zero", modelSpec: "local:qwen" }),
        node(1, "session-stopped", { stopReason: "completed", steps: 4 }),
        node(2, "reward", { costUsd: 0, latencyMs: 34_000, reward: 0.52 }),
      ]),
    );

    expect(html).toContain("make divide throw on zero");
    expect(html).toContain("local:qwen");
    expect(html).toContain("the loop completed");
    expect(html).toContain("34s");
  });

  it("says a local model cost nothing rather than hiding a zero", () => {
    const html = renderReviewPage(
      manifest,
      dagOf([
        node(0, "session-started", { task: "t", modelSpec: "local:m" }),
        node(1, "reward", { costUsd: 0, latencyMs: 1000, reward: 0.1 }),
      ]),
    );

    expect(html).toContain("a local model");
  });

  it("says the loop stopped, and why, when it did not complete", () => {
    const html = renderReviewPage(
      manifest,
      dagOf([
        node(0, "session-started", { task: "t", modelSpec: "local:m" }),
        node(1, "session-stopped", { stopReason: "model-error", steps: 0 }),
      ]),
    );

    expect(html).toContain("the loop stopped: model-error");
  });
});

describe("the gate table, which used to exist only in the terminal", () => {
  it("renders each gate with its status and detail", () => {
    const html = renderReviewPage(
      manifest,
      dagOf([
        node(0, "gate-run", {
          gateId: "tests",
          status: "passed",
          blocking: true,
          detail: "3 collected, 3 passed",
        }),
        node(1, "gate-run", {
          gateId: "diff-budget",
          status: "passed",
          blocking: false,
          detail: "within budget",
        }),
      ]),
    );

    expect(html).toContain("tests");
    expect(html).toContain("3 collected, 3 passed");
    expect(html).toContain("advisory");
  });

  /** A gate rerun under the ratchet reports more than once, and the last run is the verdict. */
  it("shows the last run of a gate rather than every attempt", () => {
    const html = renderReviewPage(
      manifest,
      dagOf([
        node(0, "gate-run", {
          gateId: "tests",
          status: "failed",
          blocking: true,
          detail: "1 failed",
        }),
        node(1, "gate-run", {
          gateId: "tests",
          status: "passed",
          blocking: true,
          detail: "all passed",
        }),
      ]),
    );

    // Scoped to the table: the evidence column below still carries every attempt, because the
    // ledger keeps them and dropping one there would be hiding a rerun rather than summarising.
    const table = html.slice(html.indexOf("<table>"), html.indexOf("</table>"));
    expect(table).toContain("all passed");
    expect(table).not.toContain("1 failed");
  });
});

describe("the change the run made", () => {
  /**
   * Nothing in the ledger answered "what did it change to my code?" before this: the file-set
   * record names files, the diff budget counts lines, and tool calls hold fragments of edits.
   */
  it("renders the patch, with added and removed lines distinguishable", () => {
    const html = renderReviewPage(
      manifest,
      dagOf([
        node(0, "workspace-diff", {
          baseRef: "HEAD",
          truncated: false,
          characters: 40,
          patch:
            "--- a/calculator.js\n+++ b/calculator.js\n@@ -1 +1,2 @@\n+  throw new Error('zero');\n-  return a / b;",
        }),
      ]),
    );

    expect(html).toContain("What changed");
    expect(html).toContain("patch-add");
    expect(html).toContain("patch-remove");
    expect(html).toContain("throw new Error");
  });

  it("says so plainly when the run changed nothing", () => {
    const html = renderReviewPage(
      manifest,
      dagOf([
        node(0, "workspace-diff", { baseRef: "HEAD", truncated: false, characters: 0, patch: "" }),
      ]),
    );

    expect(html).toContain("Nothing changed in the workspace");
  });

  it("escapes a patch, which is attacker-influenced text on a page", () => {
    const html = renderReviewPage(
      manifest,
      dagOf([
        node(0, "workspace-diff", {
          baseRef: "HEAD",
          truncated: false,
          characters: 10,
          patch: "+<script>alert(1)</script>",
        }),
      ]),
    );

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("leaves the section out entirely when no diff was recorded", () => {
    expect(renderReviewPage(manifest, dagOf([]))).not.toContain("What changed");
  });
});

describe("a bundle that covers several turns of a session", () => {
  /**
   * A session records one `session-started` per turn, and the gates and diff on the page are
   * the last turn's. Showing the first turn's task beside them would describe two different
   * pieces of work as though they were one.
   */
  it("names every task and says which one the rest of the page is about", () => {
    const html = renderReviewPage(
      manifest,
      dagOf([
        node(0, "session-started", { task: "create the calculator", modelSpec: "local:m" }),
        node(1, "session-stopped", { stopReason: "completed", steps: 7 }),
        node(2, "session-started", { task: "make divide throw", modelSpec: "local:m" }),
        node(3, "session-stopped", { stopReason: "completed", steps: 9 }),
      ]),
    );

    expect(html).toContain("2 turns");
    expect(html).toContain("create the calculator");
    expect(html).toContain("make divide throw");
    expect(html).toContain("the last turn");
    expect(html).toContain("last task");
  });

  it("says task, not last task, when there was only one", () => {
    const html = renderReviewPage(
      manifest,
      dagOf([node(0, "session-started", { task: "one thing", modelSpec: "local:m" })]),
    );

    expect(html).not.toContain("last task");
    expect(html).not.toContain("turns");
  });
});

describe("the evidence column's index", () => {
  it("counts the records by type, most common first", () => {
    const page = renderReviewPage(
      manifest,
      dagOf([node(1, "tool-call", null), node(2, "tool-call", null), node(3, "gate-run", null)]),
    );

    expect(page).toContain("3 record(s), by type:");
    expect(page.indexOf('data-type="tool-call"')).toBeLessThan(
      page.indexOf('data-type="gate-run"'),
    );
  });

  it("groups records by turn, and folds every group by default", () => {
    // A calibration bundle is 3,716 cards in one file. Expanded, that is a page nobody scrolls.
    const page = renderReviewPage(
      manifest,
      dagOf([
        node(1, "session-started", null),
        node(2, "tool-call", null),
        node(3, "session-started", null),
        node(4, "tool-call", null),
      ]),
    );

    expect(page).toContain("turn 1");
    expect(page).toContain("turn 2");
    expect(page).not.toContain('<details class="turn-group" data-group="0" open');
  });

  it("puts records that predate the first turn in a group of their own", () => {
    const page = renderReviewPage(
      manifest,
      dagOf([node(1, "local-endpoint", null), node(2, "session-started", null)]),
    );

    expect(page).toContain("before the first turn");
    expect(page).toContain("turn 1");
  });

  it("moves the digest inside the payload, where the reviewer resolving it is already looking", () => {
    const page = renderReviewPage(manifest, dagOf([node(1, "gate-run", { a: 1 })]));

    expect(page.indexOf('class="digest">sha256:')).toBeGreaterThan(
      page.indexOf("<summary>payload</summary>"),
    );
  });

  it("keeps the digest visible where there is no payload to put it in", () => {
    const page = renderReviewPage(manifest, dagOf([node(1, "gate-run", null)]));

    expect(page).toContain("the payload blob is absent from this bundle");
    expect(page).toContain('class="digest">sha256:');
  });

  it("carries what the filter matches on, decided here rather than in the browser", () => {
    const page = renderReviewPage(manifest, dagOf([node(1, "gate-run", null)]));

    expect(page).toMatch(/data-find="[^"]*gate-run[^"]*harness[^"]*"/);
  });

  it("ships the filter as part of the page, since a bundle has no server behind it", () => {
    const page = renderReviewPage(manifest, dagOf([node(1, "gate-run", null)]));

    expect(page).toContain("<script>");
    expect(page).toContain("evidence-search");
    // Self-contained: nothing fetched, so the page still works the day it is archived.
    expect(page).not.toContain("<script src=");
  });
});
