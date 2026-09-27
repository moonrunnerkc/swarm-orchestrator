import { readFile } from "node:fs/promises";
import { z } from "zod";

/**
 * What the GitHub Actions runner tells the Action, read once and validated once. Everything
 * here is data the runner set, or an input the trusted workflow declared; nothing comes from
 * the candidate. The event payload is the one document the candidate influences (a pull
 * request's title and body are theirs), so only the identities the Action needs are read from
 * it, and each is held to its shape.
 */
const sha = z.string().regex(/^[0-9a-f]{40}$/, "expected a 40-hex commit id");
const repositoryName = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);

const pullRequestEventSchema = z.object({
  pull_request: z.object({
    number: z.number().int().positive(),
    head: z.object({
      sha,
      repo: z.object({ full_name: repositoryName, fork: z.boolean() }).nullable(),
    }),
    base: z.object({ sha, repo: z.object({ full_name: repositoryName }) }),
  }),
});

export interface PullRequestIdentity {
  readonly number: number;
  readonly head: string;
  readonly base: string;
  /** The repository the head lives in, or null where GitHub no longer has it. */
  readonly headRepository: string | null;
  readonly baseRepository: string;
  readonly fork: boolean;
}

export type VerificationTarget = "head" | "merge";

export interface ActionInputs {
  /** Verify the PR head, or GitHub's test merge of it onto the base. */
  readonly target: VerificationTarget;
  readonly image: string;
  /** `docker` runs candidate commands in a measured container; `host` is explicit and recorded. */
  readonly isolation: "docker" | "host";
  readonly goalContract: string | null;
  readonly oracle: string | null;
  readonly packages: readonly string[];
  readonly install: boolean;
  /** A regression-only pass exits 1 rather than 0, for a consumer that requires a contract. */
  readonly requireTask: boolean;
  /** How requirement checks are challenged when a contract is supplied. */
  readonly challenges: "off" | "report" | "required";
  readonly comment: boolean;
  readonly token: string | null;
  /** Explicit head and base, for events that carry no pull request. */
  readonly head: string | null;
  readonly base: string | null;
  /** A prepared workspace holding the objects, instead of fetching one. */
  readonly workspace: string | null;
  /** Where to fetch objects from; defaults to the event repository on the server. */
  readonly sourceUrl: string | null;
  /** Whether a self-hosted runner is allowed, which a consumer states knowingly. */
  readonly allowSelfHosted: boolean;
}

export interface ActionContext {
  readonly eventName: string;
  readonly repository: string;
  readonly serverUrl: string;
  readonly apiUrl: string;
  readonly runId: string;
  readonly runAttempt: string;
  readonly workflowRef: string;
  readonly actor: string;
  readonly runnerEnvironment: string;
  readonly runnerTemp: string;
  readonly outputPath: string | null;
  readonly summaryPath: string | null;
  readonly pullRequest: PullRequestIdentity | null;
  readonly inputs: ActionInputs;
}

function required(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is not set; this command runs inside a GitHub Actions job`);
  return value;
}

function optional(env: Readonly<Record<string, string | undefined>>, name: string): string | null {
  const value = env[name];
  return value === undefined || value.trim().length === 0 ? null : value.trim();
}

function flag(env: Readonly<Record<string, string | undefined>>, name: string, fallback: boolean) {
  const value = optional(env, name);
  if (value === null) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false, got ${JSON.stringify(value)}`);
}

/** Read the runner's environment and the workflow's inputs into one validated context. */
export async function readActionContext(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ActionContext> {
  const eventName = required(env, "GITHUB_EVENT_NAME");
  let pullRequest: PullRequestIdentity | null = null;
  if (eventName === "pull_request" || eventName === "pull_request_target") {
    const payload = pullRequestEventSchema.parse(
      JSON.parse(await readFile(required(env, "GITHUB_EVENT_PATH"), "utf8")),
    );
    const pr = payload.pull_request;
    pullRequest = {
      number: pr.number,
      head: pr.head.sha,
      base: pr.base.sha,
      headRepository: pr.head.repo?.full_name ?? null,
      baseRepository: pr.base.repo.full_name,
      fork: pr.head.repo?.fork ?? true,
    };
  }
  const target = optional(env, "SWARM_INPUT_TARGET") ?? "head";
  if (target !== "head" && target !== "merge")
    throw new Error(`target must be head or merge, got ${JSON.stringify(target)}`);
  const isolation = optional(env, "SWARM_INPUT_ISOLATION") ?? "docker";
  if (isolation !== "docker" && isolation !== "host")
    throw new Error(`isolation must be docker or host, got ${JSON.stringify(isolation)}`);
  const challenges = optional(env, "SWARM_INPUT_CHALLENGES") ?? "report";
  if (challenges !== "off" && challenges !== "report" && challenges !== "required")
    throw new Error(
      `challenges must be off, report or required, got ${JSON.stringify(challenges)}`,
    );
  const packages = (optional(env, "SWARM_INPUT_PACKAGES") ?? "")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return {
    eventName,
    repository: repositoryName.parse(required(env, "GITHUB_REPOSITORY")),
    serverUrl: optional(env, "GITHUB_SERVER_URL") ?? "https://github.com",
    apiUrl: optional(env, "GITHUB_API_URL") ?? "https://api.github.com",
    runId: required(env, "GITHUB_RUN_ID"),
    runAttempt: optional(env, "GITHUB_RUN_ATTEMPT") ?? "1",
    workflowRef: optional(env, "GITHUB_WORKFLOW_REF") ?? "",
    actor: optional(env, "GITHUB_ACTOR") ?? "",
    runnerEnvironment: optional(env, "RUNNER_ENVIRONMENT") ?? "",
    runnerTemp: required(env, "RUNNER_TEMP"),
    outputPath: optional(env, "GITHUB_OUTPUT"),
    summaryPath: optional(env, "GITHUB_STEP_SUMMARY"),
    pullRequest,
    inputs: {
      target,
      image: optional(env, "SWARM_INPUT_IMAGE") ?? "node:24-bookworm",
      isolation,
      goalContract: optional(env, "SWARM_INPUT_GOAL_CONTRACT"),
      oracle: optional(env, "SWARM_INPUT_ORACLE"),
      packages,
      install: flag(env, "SWARM_INPUT_INSTALL", false),
      requireTask: flag(env, "SWARM_INPUT_REQUIRE_TASK", false),
      challenges,
      comment: flag(env, "SWARM_INPUT_COMMENT", true),
      token: optional(env, "SWARM_INPUT_TOKEN"),
      head: optional(env, "SWARM_INPUT_HEAD"),
      base: optional(env, "SWARM_INPUT_BASE"),
      workspace: optional(env, "SWARM_INPUT_WORKSPACE"),
      sourceUrl: optional(env, "SWARM_INPUT_SOURCE_URL"),
      allowSelfHosted: flag(env, "SWARM_INPUT_ALLOW_SELF_HOSTED", false),
    },
  };
}

export const commitId = sha;
