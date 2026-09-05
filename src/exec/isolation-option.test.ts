import { describe, expect, it } from "vitest";
import { parseIsolationOption } from "./isolation-option.ts";

describe("choosing where a run's commands execute", () => {
  it("defaults to the host, which is what a run gets when nobody asked for anything else", () => {
    expect(parseIsolationOption(null, "/repo")).toBeNull();
  });

  const installed = () => true;

  it("takes a runtime and uses a default image", () => {
    const chosen = parseIsolationOption("docker", "/repo", installed);

    expect(chosen?.runtime).toBe("docker");
    expect(chosen?.image).toContain("node:");
  });

  it("takes a runtime and an image, because a project's toolchain is not always node", () => {
    const chosen = parseIsolationOption("podman:python:3.12-bookworm", "/repo", installed);

    expect(chosen).toMatchObject({ runtime: "podman", image: "python:3.12-bookworm" });
  });

  it("refuses a runtime name that is not a runtime, rather than failing at the first command", () => {
    expect(() => parseIsolationOption("nonsense-runtime", "/repo", installed)).toThrow(
      /nonsense-runtime/,
    );
  });

  it("names none as the host, so turning it off is sayable", () => {
    expect(parseIsolationOption("none", "/repo", installed)).toBeNull();
  });

  it("refuses a runtime that is not answering, before the run spends anything", () => {
    // A run that discovers its runtime is missing after the model has edited files has spent
    // the interesting part of its budget finding out.
    expect(() => parseIsolationOption("docker", "/repo", () => false)).toThrow(/not installed/);
  });
});
