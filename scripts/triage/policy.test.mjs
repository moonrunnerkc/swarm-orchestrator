import { describe, expect, it } from "vitest";
import { decide, defaultPolicy, exercisePolicy, policyFor, reminderMarker } from "./policy.mjs";

const opened = Date.parse("2026-09-29T00:00:00Z");
const at = (hours) => opened + hours * 3_600_000;
const issue = (overrides = {}) => ({
  number: 9,
  user: "someone",
  createdAt: new Date(opened).toISOString(),
  labels: [],
  assignees: [],
  pullRequest: false,
  ...overrides,
});
const reminder = (hours) => ({
  user: "github-actions[bot]",
  createdAt: new Date(at(hours)).toISOString(),
  body: `${reminderMarker} x -->\n@moonrunnerkc ...`,
});

describe("the response promise", () => {
  it("does nothing inside the first response window, for a maintainer's own issue, or for a pull request", () => {
    expect(decide(issue(), [], at(23))).toEqual([]);
    expect(decide(issue({ user: "moonrunnerkc" }), [], at(100))).toEqual([]);
    expect(decide(issue({ pullRequest: true }), [], at(100))).toEqual([]);
  });

  it("labels overdue and mentions the maintainer once the window passes", () => {
    const actions = decide(issue(), [], at(25));
    expect(actions[0]).toEqual({ kind: "add-label", label: "overdue" });
    expect(actions[1]?.kind).toBe("comment");
    expect(actions[1]?.body).toContain("@moonrunnerkc #9");
    expect(actions[1]?.body).toContain(reminderMarker);
  });

  it("reminds again only after a full interval, every interval, until answered", () => {
    const labelled = issue({ labels: ["overdue"] });
    expect(decide(labelled, [reminder(25)], at(40))).toEqual([]);
    expect(decide(labelled, [reminder(25)], at(49)).map((action) => action.kind)).toEqual([
      "comment",
    ]);
    expect(decide(labelled, [reminder(25), reminder(49)], at(60))).toEqual([]);
  });

  it("escalates after the escalation window: labelled and assigned, and says so", () => {
    const actions = decide(issue({ labels: ["overdue"] }), [reminder(25), reminder(49)], at(73));
    expect(actions.map((action) => action.kind)).toEqual(["add-label", "assign", "comment"]);
    expect(actions[0]).toEqual({ kind: "add-label", label: "escalated" });
    expect(actions[1]).toEqual({ kind: "assign", user: "moonrunnerkc" });
    expect(actions[2]?.body).toContain("escalated");
  });

  it("stops everything at the first maintainer comment, and a reminder is not an answer", () => {
    const late = issue({ labels: ["overdue", "escalated"], assignees: ["moonrunnerkc"] });
    const answer = {
      user: "moonrunnerkc",
      createdAt: new Date(at(80)).toISOString(),
      body: "Reproduced.",
    };
    expect(decide(late, [reminder(25), answer], at(200))).toEqual([
      { kind: "remove-label", label: "overdue" },
      { kind: "remove-label", label: "escalated" },
    ]);
    const echoed = { ...reminder(30), user: "moonrunnerkc" };
    expect(decide(issue(), [echoed], at(31)).some((action) => action.kind === "comment")).toBe(
      false,
    );
  });

  it("runs a controlled exercise on shorter windows and labels every comment as one", () => {
    const labels = ["controlled-exercise", "short-windows"];
    expect(policyFor(labels)).toBe(exercisePolicy);
    expect(policyFor(["short-windows"])).toBe(defaultPolicy);
    const actions = decide(issue({ labels }), [], at(0.3), policyFor(labels));
    expect(actions.map((action) => action.kind)).toEqual(["add-label", "comment"]);
    expect(actions[1]?.body).toContain("Controlled exercise");
    expect(defaultPolicy.firstResponseHours).toBe(24);
  });
});
