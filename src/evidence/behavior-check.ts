import { z } from "zod";

const textAssertion = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("equals"), value: z.string().max(64_000) }),
  z.strictObject({ kind: z.literal("contains"), value: z.string().min(1).max(64_000) }),
]);
const argv = z.array(z.string().max(8192)).min(1).max(64);
const limits = {
  cwd: z
    .string()
    .regex(/^(?:\.|[A-Za-z0-9_][A-Za-z0-9_./-]*)$/)
    .refine((value) => !value.split("/").includes("..")),
  timeoutMs: z.number().int().min(10).max(300_000),
  maxOutputBytes: z.number().int().min(256).max(1_000_000),
  toolchain: z.string().min(1).max(256),
  network: z.literal("inherit"),
  environment: z
    .partialRecord(z.enum(["LANG", "TZ", "PLAYWRIGHT_BROWSERS_PATH"]), z.string().max(1024))
    .default({}),
};
const cli = z.strictObject({
  kind: z.literal("cli"),
  ...limits,
  argv,
  stdin: z.string().max(64_000).default(""),
  exitCode: z.number().int().min(0).max(255),
  stdout: z.array(textAssertion).max(32),
  stderr: z.array(textAssertion).max(32),
});
const http = z.strictObject({
  kind: z.literal("http"),
  ...limits,
  server: argv,
  port: z.number().int().min(1024).max(65535),
  readinessPath: z.string().regex(/^\/(?!\/)[^\s]*$/),
  readinessTimeoutMs: z.number().int().min(10).max(60_000),
  request: z.strictObject({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]),
    path: z.string().regex(/^\/(?!\/)[^\s]*$/),
    headers: z.partialRecord(z.enum(["accept", "content-type"]), z.string().max(256)),
    body: z.string().max(64_000).optional(),
    timeoutMs: z.number().int().min(10).max(60_000),
  }),
  status: z.number().int().min(100).max(599),
  headers: z.partialRecord(
    z.enum(["content-type", "cache-control", "location"]),
    z.string().max(1024),
  ),
  body: z.array(textAssertion).max(32),
  json: z
    .array(
      z.strictObject({
        path: z.array(z.string().max(256)).max(16),
        equals: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      }),
    )
    .max(32),
});
const browser = z.strictObject({
  kind: z.literal("browser"),
  ...limits,
  argv: argv.optional(),
  instrument: z
    .strictObject({
      source: z.string().min(1).max(64_000),
      titles: z
        .array(z.string().min(1).max(256))
        .min(1)
        .max(1000)
        .refine((titles) => new Set(titles).size === titles.length),
    })
    .optional(),
  expectedTests: z.number().int().positive().max(10_000),
});
export const behaviorCheckSchema = z
  .discriminatedUnion("kind", [cli, http, browser])
  .superRefine((check, context) => {
    if (check.kind !== "browser") return;
    if ((check.argv === undefined) === (check.instrument === undefined))
      context.addIssue({
        code: "custom",
        message: "browser requires exactly one of project argv or a sealed instrument",
      });
    const browserPath = check.environment.PLAYWRIGHT_BROWSERS_PATH;
    if (
      check.instrument &&
      browserPath !== undefined &&
      !["/ms-playwright", "/opt/swarm-browser/browsers"].includes(browserPath)
    )
      context.addIssue({
        code: "custom",
        message:
          "sealed browser binaries must be installed in the immutable image at /ms-playwright or /opt/swarm-browser/browsers",
      });
    if (check.instrument && check.instrument.titles.length !== check.expectedTests)
      context.addIssue({
        code: "custom",
        message: "browser expectedTests must match sealed titles",
      });
  });
export type BehaviorCheck = z.infer<typeof behaviorCheckSchema>;
