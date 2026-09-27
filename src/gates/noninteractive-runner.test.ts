import { describe, expect, it } from "vitest";
import { readNoninteractive } from "./noninteractive-runner.ts";

describe("reading a declared test command for whether it runs unattended", () => {
  it("reads a bare vitest as run mode under CI, not as interactive", () => {
    const reading = readNoninteractive("vitest");
    expect(reading.runner).toBe("vitest");
    expect(reading.interactive).toBeNull();
    expect(reading.noninteractiveBy).toContain("CI=true, which vitest reads as run mode");
  });

  it("reads vitest watch, vitest dev and vitest --watch as interactive by declaration", () => {
    for (const body of [
      "vitest watch",
      "vitest dev",
      "vitest --watch",
      "vitest -w",
      "vitest --ui",
    ]) {
      expect(readNoninteractive(body).interactive, body).not.toBeNull();
    }
    expect(readNoninteractive("vitest run --coverage").interactive).toBeNull();
  });

  it("reads jest --watchAll as interactive, and jest -w as the worker count it is", () => {
    expect(readNoninteractive("jest --watchAll").interactive).not.toBeNull();
    expect(readNoninteractive("jest --watch").interactive).not.toBeNull();
    expect(readNoninteractive("jest --watchAll=false").interactive).toBeNull();
    expect(readNoninteractive("jest -w 2").interactive).toBeNull();
    expect(readNoninteractive("jest -w 2").runner).toBe("jest");
  });

  it("steps over environment assignments and cross-env to find the runner", () => {
    expect(readNoninteractive("NODE_ENV=test jest --ci").runner).toBe("jest");
    expect(readNoninteractive("cross-env TZ=UTC mocha --watch").interactive).not.toBeNull();
    expect(readNoninteractive("cross-env TZ=UTC mocha").interactive).toBeNull();
  });

  it("recognises node --test, react-scripts test and pytest", () => {
    expect(readNoninteractive("node --test").runner).toBe("node-test");
    expect(readNoninteractive("node --test --watch").interactive).not.toBeNull();
    expect(readNoninteractive("react-scripts test").runner).toBe("react-scripts");
    expect(readNoninteractive("python -m pytest -q").runner).toBe("pytest");
    expect(readNoninteractive("pytest").runner).toBe("pytest");
  });

  it("leaves a body with shell syntax unread except for a literal --watch", () => {
    expect(readNoninteractive("npm run build && vitest").runner).toBe("other");
    expect(readNoninteractive("npm run build && vitest").interactive).toBeNull();
    expect(readNoninteractive("tsc && jest --watch").interactive).not.toBeNull();
  });

  it("reads an empty or absent body as nothing to say", () => {
    expect(readNoninteractive(undefined).interactive).toBeNull();
    expect(readNoninteractive("").runner).toBe("other");
  });
});
