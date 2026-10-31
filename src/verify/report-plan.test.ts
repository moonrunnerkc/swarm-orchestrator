import { describe, expect, it } from "vitest";
import { reportPlan } from "./report-plan.ts";

describe("recognizing a runner", () => {
  const file = "/scratch/r.report";
  const plan = (command: string, scripts: Record<string, unknown> = {}) =>
    reportPlan(command, scripts)?.command(file) ?? null;

  it("appends each runner's reporter to a command that names it", () => {
    expect(plan("python3 -m pytest -q")).toBe(
      `python3 -m pytest -q --continue-on-collection-errors --junitxml='${file}'`,
    );
    expect(plan("uv run pytest tests")).toBe(
      `uv run pytest tests --continue-on-collection-errors --junitxml='${file}'`,
    );
    expect(plan("npx jest")).toBe(`npx jest --json --outputFile='${file}'`);
    expect(plan("vitest run")).toBe(
      `vitest run --reporter=default --reporter=json --outputFile.json='${file}'`,
    );
    expect(plan("node_modules/.bin/mocha test")).toBe(
      `node_modules/.bin/mocha test --reporter json --reporter-option output='${file}'`,
    );
    expect(plan("go test ./...")).toBe(`go test -json ./... > '${file}'`);
  });

  it("reads through one package.json script, passing flags the way each manager does", () => {
    const scripts = { test: "jest --ci", unit: "vitest run" };
    expect(plan("npm run test", scripts)).toBe(`npm run test -- --json --outputFile='${file}'`);
    expect(plan("npm test", scripts)).toBe(`npm test -- --json --outputFile='${file}'`);
    expect(plan("npm run test -- --ci", scripts)).toBe(
      `npm run test -- --ci --json --outputFile='${file}'`,
    );
    expect(plan("pnpm run unit", scripts)).toBe(
      `pnpm run unit --reporter=default --reporter=json --outputFile.json='${file}'`,
    );
  });

  it("recognizes nothing it cannot place a flag in", () => {
    expect(reportPlan("node --test", {})).toBeNull();
    expect(reportPlan("pytest && ruff check", {})).toBeNull();
    expect(reportPlan("npm run test", { test: "grunt test" })).toBeNull();
    expect(reportPlan("npm run test", { test: "npm run unit", unit: "jest" })).toBeNull();
    expect(reportPlan("npm run test", { test: "go test ./..." })).toBeNull();
    expect(reportPlan("bun test", { test: "jest" })).toBeNull();
    expect(reportPlan("jest && mocha", {})).toBeNull();
    expect(reportPlan("npx jest --config jest.config.js", {})?.runner).toBe("jest");
  });
});
