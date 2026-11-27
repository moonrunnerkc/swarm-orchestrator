import { describe, expect, it } from "vitest";
import { securityApplicability } from "./security.ts";

const api = "routes in src/app.ts";
const of = (task: string, extra: Partial<Parameters<typeof securityApplicability>[0]> = {}) =>
  Object.fromEntries(
    securityApplicability({ task, api, forced: [], excluded: [], ...extra }).map((one) => [
      one.class,
      one,
    ]),
  );

describe("which security obligations a task brings", () => {
  it("applies ownership to a per-user resource, and leaves out the classes the task does not touch, with why", () => {
    const found = of("Add GET /invoices/:id/download for the authenticated user who owns it.");
    expect(found.ownership).toMatchObject({ applies: "yes" });
    expect(found.ownership?.reason).toContain('"authenticated"');
    expect(found["single-use-token"]).toEqual({
      class: "single-use-token",
      applies: "no",
      reason: "the task does not name a token, link or code that is redeemed",
    });
    expect(found["duplicate-operation"]?.reason).toBe(
      "the task does not name an operation that must not be applied twice",
    );
  });

  it("applies the token and duplicate-operation checks where the task names them", () => {
    expect(of("Add a password reset link that works once.")["single-use-token"]?.applies).toBe(
      "yes",
    );
    expect(of("Add POST /payments that charges the card.")["duplicate-operation"]?.applies).toBe(
      "yes",
    );
  });

  it("applies nothing to a project with no HTTP API, and says that is why", () => {
    const found = of("Add a payment retry helper for authenticated owners.", { api: null });
    expect(Object.values(found).map((one) => one.applies)).toEqual(["no", "no", "no"]);
    expect(found.ownership?.reason).toMatch(/holds no HTTP API the supported checks can drive/);
  });

  it("leaves ownership unknown, not excluded, where a handler changes and the wording does not say whose data it serves", () => {
    expect(of("Add a GET /reports/:id endpoint that returns the report.").ownership).toMatchObject({
      applies: "unknown",
    });
  });

  it("takes the user's word either way, and records it as theirs", () => {
    const task = "Add a GET /reports/:id endpoint that returns the report.";
    expect(of(task, { forced: ["ownership"] }).ownership).toMatchObject({
      applies: "yes",
      reason: "the user said it applies (--security)",
    });
    expect(of(task, { excluded: ["ownership"] }).ownership).toMatchObject({
      applies: "no",
      reason: "excluded by the user (--no-security)",
    });
  });
});
