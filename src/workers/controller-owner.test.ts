import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createFixedRandom, createTestClock } from "../core/test-doubles.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { acquireControllerOwner } from "./controller-owner.ts";

let root: string;
let evidence: EvidenceRecorder;
const clock = createTestClock(1000);
const random = createFixedRandom();
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "controller-owner-"));
  evidence = await openEvidenceSession({ root, sessionId: "queue", clock });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it.each(["alive", "unknown"] as const)(
  "refuses a holder whose process is %s without disturbing ownership",
  (observed) => {
    const original = acquireControllerOwner({
      evidence,
      clock,
      random,
      runtime: { pid: 123, probe: () => "absent" },
    });
    expect(() =>
      acquireControllerOwner({
        evidence,
        clock,
        random,
        runtime: { pid: 124, probe: () => observed },
      }),
    ).toThrow(`(${observed})`);
    expect(() => original.assertOwned()).not.toThrow();
    original.release();
  },
);
it("recovers only an absent owner and prevents that old handle releasing the replacement", () => {
  const original = acquireControllerOwner({
    evidence,
    clock,
    random,
    runtime: { pid: 123, probe: () => "absent" },
  });
  const recovered = acquireControllerOwner({
    evidence,
    clock,
    random,
    runtime: { pid: 124, probe: () => "absent" },
  });
  expect(() => original.assertOwned()).toThrow("ownership changed");
  original.release();
  expect(() => recovered.assertOwned()).not.toThrow();
  recovered.release();
});
