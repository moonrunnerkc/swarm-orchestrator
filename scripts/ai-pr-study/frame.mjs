#!/usr/bin/env node
/**
 * The frame and the selection for the AI-authored pull request study, exactly as the
 * registered protocol (docs/verifier-first/ai-pr-study-protocol.md) states them. Run once at
 * registration; the output is the fixed frame. Eligibility that needs the repository's
 * manifest is read here too, so the frame records why each pull request was or was not
 * eligible.
 *
 *   node scripts/ai-pr-study/frame.mjs <output directory>
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";

// `--widen <first frame.json>` runs the predeclared fallback: the same rule over the 180 days
// before registration, allowed only when the recorded first window had fewer than 100
// eligible pull requests. Repository metadata the first window already read is reused,
// since both windows are drawn on the registration day.
const args = process.argv.slice(2);
const widenAt = args.indexOf("--widen");
const firstFramePath = widenAt === -1 ? null : args[widenAt + 1];
const output = args.filter(
  (_arg, index) => widenAt === -1 || (index !== widenAt && index !== widenAt + 1),
)[0];
if (!output || (widenAt !== -1 && !firstFramePath)) {
  console.error("usage: frame.mjs <output directory> [--widen <first window frame.json>]");
  process.exit(2);
}
mkdirSync(output, { recursive: true });

const seed = "verifier-first-2026-09-27";
const until = "2026-09-27";
const firstFrame = firstFramePath ? JSON.parse(readFileSync(firstFramePath, "utf8")) : null;
const firstRepositories =
  firstFrame === null
    ? {}
    : JSON.parse(
        brotliDecompressSync(
          readFileSync(join(dirname(firstFramePath), firstFrame.repositoriesRecord)),
        ).toString("utf8"),
      );
if (firstFrame !== null && !(firstFrame.eligible < 100)) {
  console.error(
    `the first window recorded ${firstFrame.eligible} eligible pull request(s); the widening applies only under 100`,
  );
  process.exit(2);
}
const since = firstFrame === null ? "2026-06-29" : "2026-03-31";
const windowDays = firstFrame === null ? 90 : 180;
const authors = [
  "copilot-swe-agent",
  "devin-ai-integration",
  "chatgpt-codex-connector",
  "cursor",
  "claude",
  "google-labs-jules",
];
const excludedOwners = new Set(["moonrunnerkc", "Aftermath-Technologies-Ltd"]);
const tuned = new Set([
  "gvergnaud/ts-pattern",
  "gigobyte/purify",
  "koajs/koa",
  "iamkun/dayjs",
  "tj/commander.js",
  "winstonjs/winston",
]);

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256_000_000 });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One author's query is ten pages of the search API, whose budget is thirty requests a
// minute. A query that fails is retried after the budget window; one that still fails
// stops the frame, because a silently empty author would be recorded as a zero and the
// frame would be wrong without saying so.
async function searchMergedPullRequests(author, query) {
  let failure = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return JSON.parse(
        gh([
          "search",
          "prs",
          "--limit",
          "1000",
          "--json",
          "url,repository,number,title,createdAt,closedAt,author",
          "--",
          ...query.split(" "),
        ]),
      );
    } catch (cause) {
      failure = cause;
      console.error(
        `${author}: search attempt ${attempt} failed: ${cause.message.split("\n")[0]}; waiting for the search budget`,
      );
      await sleep(70_000);
    }
  }
  throw new Error(`${author}: the search failed three times: ${failure?.message}`);
}

const queriedAt = new Date().toISOString();
const results = [];
const perAuthor = {};
for (const [index, author] of authors.entries()) {
  const query = `is:pr is:merged author:app/${author} merged:${since}..${until}`;
  if (index > 0) await sleep(65_000);
  const page = await searchMergedPullRequests(author, query);
  perAuthor[author] = page.length;
  console.log(`${author}: ${page.length} merged pull request(s) in the window`);
  for (const pr of page) results.push({ ...pr, query, author: author });
}

const repositories = new Map();
for (const pr of results) {
  const name = pr.repository?.nameWithOwner ?? pr.repository?.name;
  if (!name) continue;
  if (!repositories.has(name)) repositories.set(name, null);
}
console.log(
  `${results.length} pull request(s) across ${repositories.size} repositories; reading repository metadata`,
);
const reusedMetadata = [];
for (const name of repositories.keys()) {
  const known = firstRepositories[name];
  if (known && !String(known.reason ?? "").startsWith("metadata unavailable")) {
    repositories.set(name, known);
    reusedMetadata.push(name);
    continue;
  }
  try {
    const meta = JSON.parse(
      gh([
        "api",
        `repos/${name}`,
        "--jq",
        "{stars: .stargazers_count, archived: .archived, fork: .fork, language: .language, defaultBranch: .default_branch}",
      ]),
    );
    const owner = name.split("/")[0];
    let manifest = "none";
    let lock = "none";
    const contents = JSON.parse(gh(["api", `repos/${name}/contents`, "--jq", "[.[].name]"]));
    if (contents.includes("package.json")) {
      manifest = "package.json";
      lock = contents.includes("package-lock.json")
        ? "package-lock.json"
        : contents.includes("pnpm-lock.yaml")
          ? "pnpm-lock.yaml"
          : "none";
    } else if (contents.includes("pyproject.toml")) {
      manifest = "pyproject.toml";
      lock = contents.includes("uv.lock") ? "uv.lock" : "none";
    }
    let testScript = null;
    if (manifest === "package.json") {
      try {
        const raw = gh(["api", `repos/${name}/contents/package.json`, "--jq", ".content"]);
        testScript =
          JSON.parse(Buffer.from(raw.replaceAll("\n", ""), "base64").toString("utf8")).scripts
            ?.test ?? null;
      } catch {
        testScript = null;
      }
    }
    const reason = meta.archived
      ? "archived"
      : meta.fork
        ? "fork"
        : meta.stars < 50
          ? "under 50 stars"
          : excludedOwners.has(owner)
            ? "owned by this project"
            : tuned.has(name)
              ? "used to tune the verifier"
              : manifest === "none"
                ? "no Node or Python manifest at the root"
                : lock === "none"
                  ? "no supported lockfile"
                  : manifest === "package.json" && typeof testScript !== "string"
                    ? "no test script"
                    : null;
    repositories.set(name, {
      ...meta,
      manifest,
      lock,
      testScript,
      eligible: reason === null,
      reason,
    });
  } catch (cause) {
    repositories.set(name, {
      eligible: false,
      reason: `metadata unavailable: ${cause.message.split("\n")[0]}`,
    });
  }
}

const order = (items, key) =>
  [...items].sort((a, b) => {
    const ha = createHash("sha256")
      .update(`${seed}:${key(a)}`)
      .digest("hex");
    const hb = createHash("sha256")
      .update(`${seed}:${key(b)}`)
      .digest("hex");
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  });

const eligible = results.filter(
  (pr) => repositories.get(pr.repository?.nameWithOwner ?? pr.repository?.name)?.eligible === true,
);
const ordered = order(eligible, (pr) => pr.url);
const perRepository = new Map();
const selected = [];
const remainder = [];
for (const pr of ordered) {
  const name = pr.repository?.nameWithOwner ?? pr.repository?.name;
  const count = perRepository.get(name) ?? 0;
  if (count >= 5) {
    remainder.push({ url: pr.url, reason: "per-repository cap of five" });
    continue;
  }
  perRepository.set(name, count + 1);
  if (selected.length < 50) selected.push(pr);
  else
    remainder.push({
      url: pr.url,
      reason: "beyond the first fifty; next in seeded order for a registered extension",
    });
}
const frame = {
  protocol: "docs/verifier-first/ai-pr-study-protocol.md",
  seed,
  window: { since, until, days: windowDays },
  queriedAt,
  authors,
  results: results.length,
  resultsPerAuthor: perAuthor,
  repositoriesRecord: "repositories.json.br",
  resultsRecord: "results.jsonl.br",
  widening:
    firstFrame === null
      ? null
      : {
          from: firstFramePath,
          firstWindow: firstFrame.window,
          eligibleInFirstWindow: firstFrame.eligible,
          rule: "fewer than 100 eligible in the 90-day window: the same rule over 180 days, once",
          repositoriesWithMetadataReused: reusedMetadata.length,
        },
  eligible: eligible.length,
  selected: selected.map((pr, index) => ({
    index: index + 1,
    url: pr.url,
    repository: pr.repository?.nameWithOwner ?? pr.repository?.name,
    number: pr.number,
    title: pr.title,
    author: pr.author?.login ?? pr.author,
    mergedAt: pr.closedAt,
  })),
  remainder,
  fallbackApplied:
    eligible.length < 100 && firstFrame === null
      ? "fewer than 100 eligible: the predeclared 180-day widening applies and must be run and recorded before selection is final"
      : null,
};
writeFileSync(join(output, "frame.json"), `${JSON.stringify(frame, null, 2)}\n`);
// Every repository's eligibility reading and every raw result, compressed beside the frame:
// the record is complete and the tracked tree stays within its weight.
writeFileSync(
  join(output, "repositories.json.br"),
  brotliCompressSync(`${JSON.stringify(Object.fromEntries(repositories), null, 2)}\n`),
);
writeFileSync(
  join(output, "results.jsonl.br"),
  brotliCompressSync(`${results.map((pr) => JSON.stringify(pr)).join("\n")}\n`),
);
console.log(
  `${eligible.length} eligible, ${selected.length} selected; frame written to ${join(output, "frame.json")}${frame.fallbackApplied ? `\n${frame.fallbackApplied}` : ""}`,
);
