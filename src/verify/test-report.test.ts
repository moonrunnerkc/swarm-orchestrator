import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  livesIn,
  parseGoJson,
  parseJestJson,
  parseJunit,
  parseMochaJson,
  parseReport,
  reportPlan,
} from "./test-report.ts";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "fixtures", "reports", name), "utf8");

describe("recognizing a runner", () => {
  const file = "/scratch/r.report";
  const plan = (command: string, scripts: Record<string, unknown> = {}) =>
    reportPlan(command, scripts)?.command(file) ?? null;

  it("appends each runner's reporter to a command that names it", () => {
    expect(plan("python3 -m pytest -q")).toBe(`python3 -m pytest -q --junitxml='${file}'`);
    expect(plan("uv run pytest tests")).toBe(`uv run pytest tests --junitxml='${file}'`);
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

describe("reading recorded reports", () => {
  const statuses = (report: Record<string, { status: string }> | null) =>
    Object.fromEntries(Object.entries(report ?? {}).map(([id, entry]) => [id, entry.status]));

  it("reads pytest's junit XML", () => {
    const report = parseJunit(fixture("pytest-base.xml"));
    expect(statuses(report)).toEqual({
      "tests.test_calc.TestCalc::test_stays": "pass",
      "tests.test_calc.TestCalc::test_fixed": "fail",
      "tests.test_calc.TestCalc::test_broken": "pass",
      "tests.test_calc.TestCalc::test_red": "fail",
      "tests.test_calc.TestCalc::test_gone": "pass",
    });
    expect(report?.["tests.test_calc.TestCalc::test_red"]?.file).toBe("tests/test_calc/TestCalc");
  });

  it("reads jest's and vitest's JSON with paths from the checkout root", () => {
    for (const name of ["jest-head.json", "vitest-head.json"]) {
      const report = parseJestJson(fixture(name), "/work/calc");
      expect(statuses(report)).toEqual({
        "test/calc.test.js::calc stays": "pass",
        "test/calc.test.js::calc fixed": "pass",
        "test/calc.test.js::calc broken": "fail",
        "test/calc.test.js::calc red": "fail",
        "test/calc.test.js::calc added": "pass",
      });
      expect(report?.["test/calc.test.js::calc red"]?.file).toBe("test/calc.test.js");
    }
  });

  it("reads mocha's JSON", () => {
    expect(statuses(parseMochaJson(fixture("mocha-base.json"), "/work/calc"))).toEqual({
      "test/calc.test.js::calc stays": "pass",
      "test/calc.test.js::calc fixed": "fail",
      "test/calc.test.js::calc broken": "pass",
      "test/calc.test.js::calc red": "fail",
      "test/calc.test.js::calc gone": "pass",
    });
  });

  it("reads go test -json events, the package standing in only when no test reported", () => {
    const report = parseGoJson(fixture("go-base.jsonl"), "example.com/calc");
    expect(statuses(report)).toEqual({
      "example.com/calc::TestStays": "pass",
      "example.com/calc::TestFixed": "fail",
      "example.com/calc::TestBroken": "pass",
      "example.com/calc::TestRed": "fail",
      "example.com/calc::TestGone": "pass",
    });
    expect(report?.["example.com/calc::TestRed"]?.file).toBe(".");
    const unbuilt =
      '{"Action":"start","Package":"example.com/calc/x"}\n{"Action":"fail","Package":"example.com/calc/x"}\n';
    expect(parseGoJson(unbuilt, "example.com/calc")).toEqual({
      "example.com/calc/x": { status: "fail", file: "x" },
    });
  });

  it("returns null for a report that does not parse", () => {
    expect(parseReport("pytest", "Traceback (most recent call last):", "/", null)).toBeNull();
    expect(parseReport("jest", "{ not json", "/", null)).toBeNull();
    expect(parseReport("mocha", '{"stats":{}}', "/", null)).toBeNull();
    expect(
      parseReport("go", "# example.com/calc\n./calc.go:3: syntax error\n", "/", null),
    ).toBeNull();
  });
});

describe("placing a test in a file", () => {
  it("matches each runner's notion of where a test lives", () => {
    expect(livesIn("tests/test_calc/TestCalc", "tests/test_calc.py")).toBe(true);
    expect(livesIn("tests/test_calc", "tests/test_calc.py")).toBe(true);
    expect(livesIn("tests/test_calculus/TestCalc", "tests/test_calc.py")).toBe(false);
    expect(livesIn("test/calc.test.js", "test/calc.test.js")).toBe(true);
    expect(livesIn(".", "calc_test.go")).toBe(true);
    expect(livesIn("pkg/x", "pkg/x/x_test.go")).toBe(true);
    expect(livesIn("pkg", "pkg/x/x_test.go")).toBe(false);
    expect(livesIn(null, "test/calc.test.js")).toBe(false);
  });
});
