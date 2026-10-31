import { isAbsolute, relative } from "node:path";
import { z } from "zod";
import type { TestJudgment } from "./predicate.ts";

export const runners = ["pytest", "jest", "vitest", "mocha", "go"] as const;
export type Runner = (typeof runners)[number];

/**
 * Each test's status by id. `file` names where the test lives as closely as the runner says:
 * a repository path for the JavaScript runners, a dotted module path turned into slashes for
 * pytest, the package directory for go.
 */
export const testReportSchema = z.record(
  z.string(),
  z.object({ status: z.enum(["pass", "fail", "skip"]), file: z.string().nullable() }),
);
export type TestReport = z.infer<typeof testReportSchema>;
type Status = TestReport[string]["status"];

/** What one run of a declared check leaves for judging it test by test. */
export const testEvidenceSchema = z.object({
  runner: z.enum(runners).nullable(),
  report: testReportSchema.nullable(),
  /** Why a recognized runner left no report: the command could not run, or it did not parse. */
  unreadable: z.string().nullable(),
  /** What the judge found the code under test changed, or null. */
  judge: z.string().nullable(),
});
export type TestEvidence = z.infer<typeof testEvidenceSchema>;

const rank: Record<Status, number> = { skip: 0, pass: 1, fail: 2 };

function put(report: Record<string, TestReport[string]>, id: string, entry: TestReport[string]) {
  const before = report[id];
  // A test reported twice, as reruns or parametrized ids can be, counts at its worst.
  if (before === undefined || rank[entry.status] > rank[before.status]) report[id] = entry;
}

const entities: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) =>
    name.startsWith("#x") || name.startsWith("#X")
      ? String.fromCodePoint(Number.parseInt(name.slice(2), 16))
      : name.startsWith("#")
        ? String.fromCodePoint(Number(name.slice(1)))
        : (entities[name] ?? whole),
  );

export function parseJunit(xml: string): TestReport | null {
  if (!/<testsuites?\b/.test(xml)) return null;
  const report: Record<string, TestReport[string]> = {};
  const testcase = /<testcase\b((?:[^>"']|"[^"]*"|'[^']*')*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const match of xml.matchAll(testcase)) {
    const attributes: Record<string, string> = {};
    for (const one of (match[1] ?? "").matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attributes[one[1] ?? ""] = decodeEntities(one[2] ?? one[3] ?? "");
    }
    const name = attributes.name ?? "";
    const classname = attributes.classname ?? "";
    const body = match[2] ?? "";
    const status: Status = /<(?:failure|error)\b/.test(body)
      ? "fail"
      : /<skipped\b/.test(body)
        ? "skip"
        : "pass";
    const file = attributes.file ?? (classname || name).replaceAll(".", "/");
    put(report, classname === "" ? name : `${classname}::${name}`, { status, file });
  }
  return report;
}

const fromRoot = (root: string, path: string) =>
  isAbsolute(path) ? relative(root, path).split("\\").join("/") : path;

const jestShape = z.object({
  testResults: z.array(
    z.object({
      name: z.string(),
      status: z.string().optional(),
      assertionResults: z.array(
        z.object({
          title: z.string(),
          fullName: z.string().nullish(),
          ancestorTitles: z.array(z.string()).optional(),
          status: z.string(),
        }),
      ),
    }),
  ),
});

/** Jest's --json report, which vitest's json reporter also writes. */
export function parseJestJson(text: string, root: string): TestReport | null {
  const parsed = jestShape.safeParse(safeJson(text));
  if (!parsed.success) return null;
  const report: Record<string, TestReport[string]> = {};
  for (const suite of parsed.data.testResults) {
    const file = fromRoot(root, suite.name);
    // A file that failed to load reports no tests; it stands for them as one failing entry.
    if (suite.assertionResults.length === 0 && suite.status === "failed") {
      put(report, file, { status: "fail", file });
    }
    for (const test of suite.assertionResults) {
      const title = test.fullName ?? [...(test.ancestorTitles ?? []), test.title].join(" ");
      const status: Status =
        test.status === "passed" ? "pass" : test.status === "failed" ? "fail" : "skip";
      put(report, `${file}::${title}`, { status, file });
    }
  }
  return report;
}

const mochaTest = z.object({ fullTitle: z.string(), file: z.string().optional() });
const mochaShape = z.object({
  passes: z.array(mochaTest),
  failures: z.array(mochaTest),
  pending: z.array(mochaTest),
});

export function parseMochaJson(text: string, root: string): TestReport | null {
  const parsed = mochaShape.safeParse(safeJson(text));
  if (!parsed.success) return null;
  const report: Record<string, TestReport[string]> = {};
  for (const [status, tests] of [
    ["pass", parsed.data.passes],
    ["fail", parsed.data.failures],
    ["skip", parsed.data.pending],
  ] as const) {
    for (const test of tests) {
      const file = test.file === undefined ? null : fromRoot(root, test.file);
      put(report, `${file ?? ""}::${test.fullTitle}`, { status, file });
    }
  }
  return report;
}

const goEvent = z.object({
  Action: z.string(),
  Package: z.string().optional(),
  Test: z.string().optional(),
});

/**
 * go test -json events. `module` is the go.mod module path, which turns a package's import
 * path into its directory in the repository.
 */
export function parseGoJson(text: string, module: string | null): TestReport | null {
  const report: Record<string, TestReport[string]> = {};
  const tested = new Set<string>();
  const failedPackages = new Map<string, string>();
  let events = 0;
  for (const line of text.split("\n")) {
    const event = goEvent.safeParse(line.startsWith("{") ? safeJson(line) : null);
    if (!event.success || event.data.Package === undefined) continue;
    events += 1;
    const { Action: action, Package: pkg, Test: test } = event.data;
    if (action !== "pass" && action !== "fail" && action !== "skip") continue;
    const file =
      module === null
        ? pkg
        : pkg === module
          ? "."
          : pkg.startsWith(`${module}/`)
            ? pkg.slice(module.length + 1)
            : pkg;
    if (test === undefined) {
      if (action === "fail") failedPackages.set(pkg, file);
      continue;
    }
    tested.add(pkg);
    put(report, `${pkg}::${test}`, { status: action, file });
  }
  // A package that fails with no test reported failed to build; it stands for its tests.
  for (const [pkg, file] of failedPackages) {
    if (!tested.has(pkg)) put(report, pkg, { status: "fail", file });
  }
  return events === 0 ? null : report;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parseReport(
  runner: Runner,
  text: string,
  root: string,
  goModule: string | null,
): TestReport | null {
  if (runner === "pytest") return parseJunit(text);
  if (runner === "go") return parseGoJson(text, goModule);
  if (runner === "mocha") return parseMochaJson(text, root);
  return parseJestJson(text, root);
}

/** Whether a test reported with `file` lives in the repository path `path`. */
export function livesIn(file: string | null, path: string): boolean {
  if (file === null) return false;
  if (path.endsWith("_test.go")) {
    const directory = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
    return file === directory;
  }
  const stem = path.replace(/\.[^./]+$/, "");
  return file === path || file === stem || file.startsWith(`${stem}/`);
}

type Lists = Omit<TestJudgment, "runner" | "counts">;

/**
 * Test by test: passing at base and not with the change is a regression; failing at base and
 * passing is fixed; failing at both is pre-existing; present at base and missing is a deletion,
 * allowed only where `deletable` says the change may edit the file the test lived in. A test
 * that did not run at base and fails with the change is newly failing.
 */
export function compareReports(
  base: TestReport,
  head: TestReport,
  deletable: (file: string | null) => boolean,
): Omit<TestJudgment, "runner"> {
  const lists: { [key in keyof Lists]: string[] } = {
    fixed: [],
    regressed: [],
    preExisting: [],
    deleted: [],
    allowedDeletions: [],
    newlyFailing: [],
  };
  let passing = 0;
  let added = 0;
  let skipped = 0;
  for (const [id, before] of Object.entries(base)) {
    const after = head[id];
    if (after === undefined) {
      (deletable(before.file) ? lists.allowedDeletions : lists.deleted).push(id);
    } else if (before.status === "pass") {
      if (after.status === "pass") passing += 1;
      else lists.regressed.push(id);
    } else if (after.status === "pass") lists.fixed.push(id);
    else if (before.status === "fail") lists.preExisting.push(id);
    else if (after.status === "fail") lists.newlyFailing.push(id);
    else skipped += 1;
  }
  for (const [id, after] of Object.entries(head)) {
    if (id in base) continue;
    if (after.status === "pass") added += 1;
    else if (after.status === "fail") lists.newlyFailing.push(id);
    else skipped += 1;
  }
  const counts = { passing, added, skipped } as TestJudgment["counts"];
  const capped = {} as Lists;
  for (const [key, ids] of Object.entries(lists) as [keyof Lists, string[]][]) {
    counts[key] = ids.length;
    capped[key] = ids.slice(0, 100);
  }
  return { counts, ...capped };
}
