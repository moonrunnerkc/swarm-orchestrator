#!/usr/bin/env node
/**
 * A wider pool of repositories for the pull-request miner, chosen by the campaign's own rule.
 *
 * The miner reads its repositories from the campaign's sealed selection, which holds 26
 * JavaScript and TypeScript repositories, and those yield viable tasks in 14. A cohort that has
 * to span twenty repositories cannot come from that list however deep the miner digs, so the
 * pool is widened here, and widened by walking the same search further rather than by anybody
 * choosing names:
 *
 *   - the same query, one per language and license keyword, in the same star-then-name order;
 *   - the same rules the campaign applies from the search and from a checkout, read from
 *     `campaign/harness` and not restated;
 *   - skipping every repository the miner has already been given, so nothing is mined twice.
 *
 * Two differences from the campaign's walk, both named. The campaign also ran each repository's
 * whole suite offline in a container, which is a requirement of the ratchet measurements it
 * exists for; a mined task is instead admitted only where its own test file fails on the base and
 * passes on the merge, which `check-pr-task-viability.mjs` establishes by running it, so the
 * container is not asked here. And the lockfile has to be `package-lock.json`, because the mined
 * task pipeline installs with `npm ci` and nothing else: a pnpm repository would reach the
 * viability check only to fail its install.
 *
 * What a task has to satisfy is untouched. This decides which repositories are looked at.
 *
 *   node scripts/pr-task-repository-pool.mjs [--per-language <n>] [--out <file>] [--after <pool.json>]
 *
 * `--after` continues an earlier walk: every repository that walk decided, accepted or rejected,
 * is passed over, and the walk goes on down the same order under the same rules. Its accepted
 * repositories are also skipped by the miner's already-mined rule, so nothing is mined twice.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

import { candidateFrom, orderCandidates, walkCandidates } from "../campaign/harness/candidates.mjs";
import { licenses, search, searchQuery } from "../campaign/harness/criteria.mjs";
import { pagesFor, searchArgv } from "../campaign/harness/github-search.mjs";
import { countLines } from "../campaign/harness/line-count.mjs";
import { readManifestFacts } from "../campaign/harness/manifest-facts.mjs";
import { rejectionFromCheckout, rejectionFromSearch } from "../campaign/harness/rules.mjs";

const run = promisify(execFile);
const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);

export const poolLanguages = Object.freeze(["JavaScript", "TypeScript"]);

/** The lockfile `npm ci` reads, which is the only install the mined-task pipeline performs. */
export const minedTaskLockfile = "package-lock.json";

/** The repositories the miner has already been given: the campaign selection it reads by default. */
export function alreadyMined(selection) {
  const entries = Array.isArray(selection) ? selection : Object.values(selection)[0];
  return new Set(
    entries
      .filter((one) => one.accepted !== false && poolLanguages.includes(one.language ?? ""))
      .map((one) => one.fullName),
  );
}

/** Every repository earlier walks decided, and those they accepted, for a walk that continues them. */
export function earlierWalks(pools) {
  const decided = new Set();
  const accepted = new Set();
  for (const pool of pools) {
    for (const one of pool.decisions ?? []) decided.add(one.fullName);
    for (const one of pool.accepted ?? []) accepted.add(one.fullName);
  }
  return { decided, accepted };
}

/** The walk order with every repository an earlier walk already decided taken out of it. */
export function continuing(candidates, decided) {
  return candidates.filter((candidate) => !decided.has(candidate.fullName));
}

/**
 * The rule for one candidate, in the order it is applied: already mined, then the campaign's
 * search rules, then its checkout rules, then the lockfile the pipeline can install. The first
 * rule a candidate fails is its reason, as in the campaign's walk.
 */
export async function judgeForPool(candidate, { mined, inspect }) {
  if (mined.has(candidate.fullName)) {
    return { accepted: false, reason: "already in the pool the miner reads" };
  }
  const early = rejectionFromSearch(candidate);
  if (early !== null) return { accepted: false, reason: early };
  const checkout = await inspect(candidate);
  if (checkout.failure !== null) return { accepted: false, reason: checkout.failure };
  const late = rejectionFromCheckout(candidate, checkout.facts, checkout.lines);
  if (late !== null) {
    return { accepted: false, reason: late, commit: checkout.commit, lines: checkout.lines };
  }
  if (checkout.facts.lockfile !== minedTaskLockfile) {
    return {
      accepted: false,
      reason: `lockfile ${checkout.facts.lockfile}: the mined-task install reads ${minedTaskLockfile} only`,
      commit: checkout.commit,
      lines: checkout.lines,
    };
  }
  return { accepted: true, commit: checkout.commit, lines: checkout.lines };
}

async function main() {
  const argv = process.argv.slice(2);
  const option = (name, fallback) => {
    const at = argv.indexOf(name);
    return at === -1 ? fallback : argv[at + 1];
  };
  const perLanguage = Number(option("--per-language", "15"));
  const outPath = resolve(
    repositoryRoot,
    option("--out", "campaign/pr-tasks/repository-pool.json"),
  );
  if (existsSync(outPath)) {
    throw new Error(`${outPath} exists, and a second walk would be a second pool`);
  }
  const scratch = join(homedir(), ".cache", "swarm-pr-tasks", "pool");
  mkdirSync(scratch, { recursive: true });
  const now = () => new Date().toISOString();

  const selectionPath = join(repositoryRoot, "campaign/selection/repos.json");
  const earlier = argv
    .flatMap((word, at) => (word === "--after" ? [argv[at + 1]] : []))
    .map((path) => resolve(repositoryRoot, path));
  const prior = earlierWalks(earlier.map((path) => JSON.parse(readFileSync(path, "utf8"))));
  const mined = new Set([
    ...alreadyMined(JSON.parse(readFileSync(selectionPath, "utf8"))),
    ...prior.accepted,
  ]);

  // Thirty search requests a minute is GitHub's limit for an authenticated caller.
  const fetched = [];
  for (const language of poolLanguages) {
    for (const keyword of Object.values(licenses)) {
      const query = searchQuery(language, keyword);
      for (let page = 1; page <= pagesFor(); page += 1) {
        await new Promise((done) => setTimeout(done, 2200));
        const { stdout } = await run("gh", searchArgv({ query, page }), {
          maxBuffer: 64 * 1024 * 1024,
        });
        const items = JSON.parse(stdout).items ?? [];
        for (const item of items) fetched.push({ ...item, campaignQuery: query, fetchedAt: now() });
        if (items.length < search.pageSize) break;
      }
    }
  }
  const raw = gzipSync(`${fetched.map((item) => JSON.stringify(item)).join("\n")}\n`);
  const rawPath = join(scratch, "search-results.jsonl.gz");
  writeFileSync(rawPath, raw);

  const byLanguage = Object.fromEntries(
    poolLanguages.map((language) => [
      language,
      continuing(
        orderCandidates(fetched.filter((item) => item.language === language).map(candidateFrom)),
        prior.decided,
      ),
    ]),
  );

  const inspect = async (candidate) => {
    const checkout = join(scratch, "checkouts", candidate.fullName.replace("/", "__"));
    rmSync(checkout, { recursive: true, force: true });
    try {
      await run(
        "git",
        [
          "clone",
          "--quiet",
          "--depth",
          "1",
          "--branch",
          candidate.defaultBranch,
          candidate.cloneUrl,
          checkout,
        ],
        { timeout: 5 * 60_000 },
      );
      const commit = (await run("git", ["rev-parse", "HEAD"], { cwd: checkout })).stdout.trim();
      const facts = await readManifestFacts(checkout);
      const counted = await countLines(checkout, candidate.language);
      return { failure: null, commit, facts, lines: counted.lines };
    } catch (cause) {
      return { failure: `checkout unreadable: ${String(cause?.message ?? cause).slice(0, 200)}` };
    } finally {
      rmSync(checkout, { recursive: true, force: true });
    }
  };

  const walked = await walkCandidates(
    byLanguage,
    async (candidate) => {
      const verdict = await judgeForPool(candidate, { mined, inspect });
      console.log(
        `${candidate.language.padEnd(11)} ${candidate.fullName.padEnd(48)} ${verdict.accepted ? "ACCEPT" : verdict.reason}`,
      );
      return { ...verdict, judgedAt: now() };
    },
    { quotas: Object.fromEntries(poolLanguages.map((language) => [language, perLanguage])) },
  );

  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        schema: "swarm.pr-task.repository-pool.v1",
        rule:
          "the campaign selection's search, order, search rules and checkout rules " +
          "(campaign/criteria.md), skipping repositories already in campaign/selection/repos.json " +
          "and every repository an earlier walk named here decided, " +
          `requiring ${minedTaskLockfile}, and not running the container suite`,
        queriedAt: fetched[0]?.fetchedAt ?? now(),
        searchResults: {
          items: fetched.length,
          digest: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
          keptAt: "~/.cache/swarm-pr-tasks/pool/search-results.jsonl.gz, outside the repository",
        },
        perLanguage,
        continues: earlier.map((path) => relative(repositoryRoot, path)),
        shortfalls: walked.shortfalls,
        decisions: walked.decisions,
        accepted: walked.accepted,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `\n${walked.accepted.length} repositories accepted of ${walked.decisions.length} walked: ${outPath}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((cause) => {
    console.error(cause?.message ?? cause);
    process.exit(1);
  });
}
