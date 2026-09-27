import { z } from "zod";

const test = z.object({
  projectName: z.string(),
  expectedStatus: z.literal("passed"),
  status: z.enum(["expected", "unexpected", "flaky", "skipped"]),
  results: z
    .array(
      z.object({
        status: z.enum(["passed", "failed", "timedOut", "skipped", "interrupted"]),
        errors: z.array(z.unknown()),
      }),
    )
    .min(1)
    .max(100),
});
const spec = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  file: z.string().optional(),
  tests: z.array(test).min(1),
});
interface Suite {
  specs: z.infer<typeof spec>[];
  suites?: Suite[] | undefined;
}
const suite: z.ZodType<Suite> = z.lazy(() =>
  z.object({
    specs: z.array(spec),
    suites: z.array(suite).optional(),
  }),
);
const report = z.object({
  stats: z.object({
    expected: z.number().int().nonnegative(),
    unexpected: z.number().int().nonnegative(),
    flaky: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  errors: z.array(z.unknown()),
  suites: z.array(suite),
});

/** Require individual executed test results, unique identities and agreeing aggregate counts. */
export function browserResultsPass(
  value: unknown,
  expectedTests: number,
  expectedTitles?: readonly string[],
): boolean {
  const parsed = report.parse(value);
  const points: {
    id: string;
    title: string | undefined;
    file: string | undefined;
    test: z.infer<typeof test>;
  }[] = [];
  const visit = (suites: Suite[], depth: number): void => {
    if (depth > 32 || points.length > 100000) throw new Error("browser report exceeds bounds");
    for (const group of suites) {
      for (const entry of group.specs)
        for (const result of entry.tests)
          points.push({
            id: `${entry.id}:${result.projectName}`,
            title: entry.title,
            file: entry.file,
            test: result,
          });
      visit(group.suites ?? [], depth + 1);
    }
  };
  visit(parsed.suites, 0);
  if (new Set(points.map((entry) => entry.id)).size !== points.length)
    throw new Error("duplicate browser test identity");
  const count = (status: string) => points.filter((entry) => entry.test.status === status).length;
  if (
    parsed.stats.expected !== count("expected") ||
    parsed.stats.unexpected !== count("unexpected") ||
    parsed.stats.flaky !== count("flaky") ||
    parsed.stats.skipped !== count("skipped")
  )
    throw new Error("browser totals disagree with individual results");
  return (
    points.length === expectedTests &&
    (expectedTitles === undefined ||
      (new Set(points.map((point) => point.title)).size === expectedTitles.length &&
        points.every(
          (point) =>
            point.file === "instrument.spec.mjs" &&
            point.test.projectName === "chromium" &&
            point.title !== undefined &&
            expectedTitles.includes(point.title),
        ))) &&
    parsed.errors.length === 0 &&
    points.every(
      ({ test: result }) =>
        result.status === "expected" &&
        result.results.length === 1 &&
        result.results[0]?.status === "passed" &&
        result.results[0].errors.length === 0,
    )
  );
}
