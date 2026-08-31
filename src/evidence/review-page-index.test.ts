import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFixedRandom, createTestClock } from "../core/test-doubles.ts";
import { bundleSourceFromRecorder, exportBundle } from "./bundle.ts";
import { renderReviewPage } from "./review-page.ts";
import { createSessionId, type EvidenceRecorder, openEvidenceSession } from "./session.ts";
import { createEphemeralSigningKey } from "./signing.ts";
import { verifyBundle } from "./verifier/verify.mjs";

/**
 * The evidence column, and the one thing this change must not have cost: a bundle produced
 * before it still verifies, because the page is a rendering of the chain and the verifier
 * reads the chain.
 */

let root = "";
let evidence: EvidenceRecorder;
const clock = createTestClock(1_700_000_000_000);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-review-index-"));
  evidence = await openEvidenceSession({
    root: join(root, "sessions"),
    sessionId: createSessionId(clock, createFixedRandom()),
    clock,
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function turn(task: string, calls: number): Promise<void> {
  await evidence.record({
    type: "session-started",
    actor: "harness",
    provenance: ["user"],
    payload: { task, modelSpec: "fixture:model" },
  });
  for (let call = 1; call <= calls; call += 1) {
    await evidence.record({
      type: "tool-call",
      actor: "fixture:model",
      provenance: ["model"],
      payload: { callId: `c${call}`, toolName: "read", decision: "allowed" },
    });
  }
  await evidence.record({
    type: "session-stopped",
    actor: "harness",
    provenance: ["model"],
    payload: { stopReason: "completed", steps: calls },
  });
}

async function exportInto(destination: string) {
  return await exportBundle({
    source: bundleSourceFromRecorder(evidence),
    destination,
    signingKey: createEphemeralSigningKey(),
    clock,
  });
}

async function page(): Promise<string> {
  const bundle = await exportInto(join(root, "bundle"));
  return renderReviewPage(bundle.manifest, bundle.dag);
}

describe("the index the evidence column opens with", () => {
  it("counts the records and says how many groups they fall into", async () => {
    await turn("add a divide function", 2);
    await turn("cover the remainder", 1);

    const html = await page();

    expect(html).toContain("record(s), in 2 group(s)");
  });

  it("links each turn, with its task and how many records it holds", async () => {
    await turn("add a divide function", 2);
    await turn("cover the remainder", 1);

    const html = await page();

    expect(html).toContain('href="#turn-1"');
    expect(html).toContain('href="#turn-2"');
    expect(html).toContain("add a divide function");
    expect(html).toContain("cover the remainder");
  });

  it("links the first record of each kind, so a kind is reachable without scrolling", async () => {
    await turn("add a divide function", 2);

    const html = await page();

    expect(html).toContain(">tool-call</a>");
    expect(html).toContain(">session-started</a>");
  });

  it("leaves the turn list out of a bundle with one turn, which needs no navigating", async () => {
    await turn("add a divide function", 1);

    const html = await page();

    expect(html).toContain("in 1 group(s)");
    expect(html).not.toContain('href="#turn-1"');
  });

  it("groups records under the turn that produced them, in chain order", async () => {
    await turn("first", 1);
    await turn("second", 1);

    const html = await page();
    const firstHeading = html.indexOf('id="turn-1"');
    const secondHeading = html.indexOf('id="turn-2"');

    expect(firstHeading).toBeGreaterThan(-1);
    expect(secondHeading).toBeGreaterThan(firstHeading);
  });
});

describe("what a record card shows before it is opened", () => {
  it("keeps the head line visible, so a claim's link lands somewhere a reader can see", async () => {
    // Collapsed with no script and no reliance on a browser opening a closed ancestor for a
    // fragment: the anchor is the details element itself and its summary is always rendered.
    await turn("add a divide function", 1);

    const html = await page();

    expect(html).toMatch(/<details class="record" id="record-\d+"><summary class="record-head">/);
  });

  it("holds the digest inside, where the person who wants it is already looking", async () => {
    await turn("add a divide function", 1);

    const html = await page();
    const card = html.slice(html.indexOf('<details class="record"'));
    const summaryEnd = card.indexOf("</summary>");

    expect(summaryEnd).toBeGreaterThan(-1);
    expect(card.slice(0, summaryEnd)).not.toContain("sha256:");
    expect(card).toContain('<p class="digest">sha256:');
  });
});

describe("a bundle exported before the column was indexed", () => {
  it("still verifies, because the page renders the chain and the verifier reads the chain", async () => {
    await turn("add a divide function", 2);
    const directory = join(root, "bundle");
    await exportInto(directory);

    // The page as it stood before this change, written over the one the export just produced.
    // Nothing the verifier reads is touched by either rendering.
    await writeFile(
      join(directory, "review.html"),
      "<!doctype html><html><body>the previous rendering</body></html>",
      "utf8",
    );

    // The embedded verifier's own exit code, which is what `node verify.mjs .` answers with.
    expect(verifyBundle(directory)).toBe(0);
    expect(await readdir(directory)).toContain("review.html");
  });
});
