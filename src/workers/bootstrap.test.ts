import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { createSystemClock } from "../cli-runtime-inputs.ts";
import { asJsonValue } from "../evidence/canonical-json.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { readControllerHistory } from "../evidence/verifier/controller.mjs";
import { hostExecutionBackend, type IsolationBackend } from "../exec/execution-mode.ts";
import { bootstrapRepository } from "./bootstrap.ts";
import { bootstrapHistory } from "./bootstrap-history.ts";
import { controllerLaunchSchema, declareControllerLaunch } from "./controller-launch.ts";
import { createRunContext } from "./run-context.ts";

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(format = "sha1") {
  const root = await mkdtemp(join(tmpdir(), "swarm-bootstrap-"));
  roots.push(root);
  const repository = join(root, "repo");
  await mkdir(repository);
  const git = async (...args: string[]) =>
    (
      await execute("git", [
        "-C",
        repository,
        "-c",
        "user.name=fixture",
        "-c",
        "user.email=fixture@example.com",
        ...args,
      ])
    ).stdout.trim();
  await git("init", "-q", `--object-format=${format}`);
  await git("commit", "--allow-empty", "-qm", "empty");
  const clock = createSystemClock();
  const evidence = await openEvidenceSession({
    root: join(root, "sessions"),
    sessionId: "bootstrap",
    clock,
  });
  const launch = await declareControllerLaunch(
    evidence,
    controllerLaunchSchema.parse({
      version: 3,
      bootstrap: "node",
      controllerScope: { kind: "workspace", allowedPaths: [], immutablePaths: [] },
      runId: "bootstrap",
      repositoryRoot: repository,
      baseCommit: await git("rev-parse", "HEAD"),
      scratchRoot: join(root, "trees"),
      goal: "create a counter",
      tasks: [],
      graph: null,
      suppliedGoal: null,
      modelSpec: "fixture:bootstrap",
      localBaseUrl: null,
      localThinking: null,
      maxSteps: 5,
      attempts: 0,
      maxWallMs: 60000,
      maxTokens: 10000,
      repairAttempts: 1,
      redundancy: 1,
      concurrency: 1,
      modelConcurrency: 1,
      testConcurrency: 1,
      isolation: null,
      gateOptions: {},
      bundleDirectory: null,
    }),
  );
  const abort = new AbortController();
  const context = await createRunContext({
    evidence,
    clock,
    runId: launch.runId,
    maxTokens: launch.maxTokens,
    maxWallMs: launch.maxWallMs,
    modelConcurrency: 1,
    testConcurrency: 1,
    signal: abort.signal,
  });
  return { root, repository, git, launch, evidence, context, abort };
}

it.each(["sha1", "sha256"])(
  "retains exactly the setup objects and independently re-derives its controls (%s)",
  async (format) => {
    const options = await fixture(format);
    try {
      const setup = await bootstrapRepository(options);
      expect(await options.git("show", `${setup.baseCommit}:package.json`)).toContain(
        '"node": ">=24"',
      );
      expect(await options.git("rev-parse", "HEAD")).toBe(options.launch.baseCommit);
      expect(await options.git("status", "--porcelain")).toBe("");
      expect(
        bootstrapHistory(options.evidence).filter((entry) => entry.payload.phase === "ready"),
      ).toHaveLength(1);
      expect(
        readControllerHistory(options.evidence.records(), options.evidence.payloads()).problems,
      ).toEqual([]);
      await setup.cleanup(new AbortController().signal);
      const recovered = await bootstrapRepository(options);
      expect(recovered.baseCommit).toBe(setup.baseCommit);
      expect(
        bootstrapHistory(options.evidence).filter(
          (entry) => entry.payload.phase === "check-observed",
        ),
      ).toHaveLength(3);
      await recovered.cleanup(new AbortController().signal);
    } finally {
      options.context.dispose();
    }
  },
);

it("refuses a nonempty base and preserves untracked user work", async () => {
  const options = await fixture();
  try {
    await writeFile(join(options.repository, "user.txt"), "keep this");
    await expect(bootstrapRepository(options)).rejects.toThrow("empty Git base");
    expect(await readFile(join(options.repository, "user.txt"), "utf8")).toBe("keep this");
    expect(bootstrapHistory(options.evidence)).toHaveLength(0);
  } finally {
    options.context.dispose();
  }
});

it("refuses unavailable execution and a runner that ignores the negative control within the retry cap", async () => {
  const options = await fixture();
  const ignored: IsolationBackend = {
    ...hostExecutionBackend,
    run: async (argv, invocation) => {
      if (invocation.cwd.endsWith("bootstrap-negative"))
        return {
          stdout: "# tests 0\n# fail 0\n",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          cancelled: false,
          truncated: false,
          startFailure: null,
        };
      return hostExecutionBackend.run(argv, invocation);
    },
  };
  try {
    for (let attempt = 0; attempt < 3; attempt++)
      await expect(bootstrapRepository({ ...options, isolation: () => ignored })).rejects.toThrow(
        "bootstrap negative was not established",
      );
    await expect(bootstrapRepository({ ...options, isolation: () => ignored })).rejects.toThrow(
      "retry cap exhausted",
    );
    expect(
      bootstrapHistory(options.evidence).some((entry) => entry.payload.phase === "ready"),
    ).toBe(false);
  } finally {
    options.context.dispose();
  }
  const unavailable = await fixture();
  try {
    await expect(
      bootstrapRepository({
        ...unavailable,
        isolation: () => ({
          ...hostExecutionBackend,
          run: async () => ({
            stdout: "",
            stderr: "unavailable",
            exitCode: 127,
            timedOut: false,
            cancelled: false,
            truncated: false,
            startFailure: "backend unavailable",
          }),
        }),
      }),
    ).rejects.toThrow("toolchain was not established");
  } finally {
    unavailable.context.dispose();
  }
});

it("recovers a crash after effect intent and rejects altered owned files during cleanup", async () => {
  const options = await fixture();
  let crashed = false;
  const evidence = {
    ...options.evidence,
    record: async (input: Parameters<typeof options.evidence.record>[0]) => {
      const captured = await options.evidence.record(input);
      if (
        !crashed &&
        input.type === "bootstrap-stage" &&
        (input.payload as { phase?: string }).phase === "check-intent"
      ) {
        crashed = true;
        throw new Error("injected process death after intent");
      }
      return captured;
    },
  };
  try {
    await expect(bootstrapRepository({ ...options, evidence })).rejects.toThrow(
      "injected process death",
    );
    const restored = await bootstrapRepository(options);
    expect(
      bootstrapHistory(options.evidence).filter((entry) => entry.payload.phase === "intent"),
    ).toHaveLength(1);
    await writeFile(join(restored.workspace, "user.txt"), "retain after interruption");
    await expect(restored.cleanup(new AbortController().signal)).rejects.toThrow(
      "unexpected or altered file",
    );
    expect(await readFile(join(restored.workspace, "user.txt"), "utf8")).toBe(
      "retain after interruption",
    );
    expect(
      readControllerHistory(options.evidence.records(), options.evidence.payloads()).problems,
    ).toEqual([]);
  } finally {
    options.context.dispose();
  }
});

it("cancels while waiting for the shared test permit without launching a check", async () => {
  const options = await fixture();
  let release: (() => void) | undefined;
  const occupied = options.context.tests.run(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    new AbortController().signal,
  );
  const evidence = {
    ...options.evidence,
    record: async (input: Parameters<typeof options.evidence.record>[0]) => {
      const captured = await options.evidence.record(input);
      if (
        input.type === "bootstrap-stage" &&
        (input.payload as { phase?: string }).phase === "check-intent"
      )
        options.abort.abort(new Error("cancel queued bootstrap"));
      return captured;
    },
  };
  let calls = 0;
  try {
    await expect(
      bootstrapRepository({
        ...options,
        evidence,
        isolation: () => ({
          ...hostExecutionBackend,
          run: async (...args) => {
            calls++;
            return hostExecutionBackend.run(...args);
          },
        }),
      }),
    ).rejects.toThrow("cancel queued bootstrap");
    expect(calls).toBe(0);
    expect(
      bootstrapHistory(options.evidence).filter(
        (entry) => entry.payload.phase === "check-observed",
      ),
    ).toHaveLength(0);
  } finally {
    release?.();
    await occupied;
    options.context.dispose();
  }
});

it("independently refuses forged bootstrap controls, identities, ordering and acceptance", async () => {
  const options = await fixture();
  try {
    await bootstrapRepository(options);
    const records = options.evidence.records();
    const original = options.evidence.payloads();
    for (const [phase, change] of [
      ["intent", { commit: "f".repeat(40) }],
      ["check-intent", { files: {} }],
      ["check-intent", { argv: ["true"] }],
      [
        "check-observed",
        {
          observation: {
            stdout: "24.0.0",
            stderr: "",
            exitCode: 0,
            timedOut: false,
            cancelled: false,
            truncated: true,
            startFailure: null,
          },
        },
      ],
      ["ready", { checks: [] }],
    ] as const) {
      const subject = records.find(
        (entry) =>
          entry.type === "bootstrap-stage" &&
          (original.get(entry.payloadDigest) as { phase?: string }).phase === phase,
      );
      if (subject === undefined) throw new Error(`missing fixture phase ${phase}`);
      const payload = original.get(subject.payloadDigest);
      const altered = new Map(original);
      altered.set(
        subject.payloadDigest,
        asJsonValue({ ...(payload as Record<string, unknown>), ...change }),
      );
      expect(readControllerHistory(records, altered).problems, phase).not.toEqual([]);
    }
    const intent = records.find((entry) => entry.type === "bootstrap-stage");
    expect(
      readControllerHistory(
        records.filter((entry) => entry !== intent),
        original,
      ).problems,
    ).not.toEqual([]);
    const modelAuthority = records.map((entry) =>
      entry === intent ? { ...entry, actor: "model" } : entry,
    );
    expect(readControllerHistory(modelAuthority, original).problems).not.toEqual([]);
  } finally {
    options.context.dispose();
  }
});
