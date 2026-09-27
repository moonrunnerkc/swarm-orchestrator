#!/usr/bin/env node
/**
 * The selection rule for the README-only onboarding simulations, run before any repository
 * is tried with the verifier and recorded with its query, date, candidate list and seed.
 *
 * Three categories, one repository each: a real Vite application, a real Express API, and a
 * real Python project, each independently maintained, public, active and starred, and none
 * of them a framework repository, a template, a demo the owner controls, or a repository
 * already used to tune these integrations. Eligibility is read from the repository's own
 * metadata and manifest, never from whether the verifier is likely to succeed on it.
 *
 *   node scripts/onboarding/select-repositories.mjs <seed> <output.json>
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const [seed, output] = process.argv.slice(2);
if (!seed || !output) {
  console.error("usage: select-repositories.mjs <seed> <output.json>");
  process.exit(2);
}
const date = new Date().toISOString().slice(0, 10);
const pushedSince = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);

/** Repositories excluded by rule: frameworks, templates, and those this project tuned on. */
const excludedOwners = new Set([
  "vitejs",
  "expressjs",
  "moonrunnerkc",
  "Aftermath-Technologies-Ltd",
]);
const excludedNamePattern =
  /(template|starter|boilerplate|example|examples|demo|awesome|tutorial|course|playground|sample)/i;
/** Repositories used to tune the verifier's discovery or its campaigns, by exact name. */
const tuned = new Set([
  "gvergnaud/ts-pattern",
  "gigobyte/purify",
  "koajs/koa",
  "iamkun/dayjs",
  "tj/commander.js",
  "winstonjs/winston",
]);

const categories = [
  {
    id: "vite",
    query: "topic:vite stars:>=100 language:TypeScript archived:false",
    manifest: (pkg) =>
      typeof pkg?.scripts?.test === "string" &&
      (pkg.devDependencies?.vite !== undefined || pkg.dependencies?.vite !== undefined) &&
      pkg.private === true,
    prerequisites: "Node and a package manager, as the repository README states",
  },
  {
    id: "express",
    query: "topic:express stars:>=100 archived:false",
    // An application, not a library: express is a runtime dependency, a test script exists, and
    // the manifest is not published for consumers (private, or without main/exports/bin). The
    // first draw under a looser rule selected a Fastify compatibility layer, a library; the
    // rule was tightened by type before any repository was run and the draw repeated.
    manifest: (pkg) =>
      typeof pkg?.scripts?.test === "string" &&
      pkg.dependencies?.express !== undefined &&
      (pkg.private === true ||
        (pkg.main === undefined && pkg.exports === undefined && pkg.bin === undefined)),
    prerequisites: "Node and a package manager, as the repository README states",
  },
  {
    id: "python",
    query: "language:Python topic:pytest stars:>=100 archived:false",
    manifest: (pyproject) =>
      typeof pyproject === "string" && /pytest/.test(pyproject) && /\[project\]/.test(pyproject),
    prerequisites: "Python 3 and the tooling the repository README states",
  },
];

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64_000_000 });
}

function manifestOf(fullName, path) {
  try {
    const raw = gh(["api", `repos/${fullName}/contents/${path}`, "--jq", ".content"]);
    return Buffer.from(raw.replaceAll("\n", ""), "base64").toString("utf8");
  } catch {
    return null;
  }
}

/** A seeded order: sha256 of seed and name, sorted, so the pick is reproducible from the list. */
function seededOrder(names, salt) {
  return [...names].sort((a, b) => {
    const ha = createHash("sha256").update(`${seed}:${salt}:${a}`).digest("hex");
    const hb = createHash("sha256").update(`${seed}:${salt}:${b}`).digest("hex");
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  });
}

const frame = { date, seed, pushedSince, categories: [] };
for (const category of categories) {
  const query = `${category.query} pushed:>=${pushedSince}`;
  const found = JSON.parse(
    gh([
      "search",
      "repos",
      "--limit",
      "100",
      "--json",
      "fullName,stargazersCount,pushedAt,description,isArchived,isFork",
      "--sort",
      "stars",
      "--",
      ...query.split(" "),
    ]),
  );
  const candidates = [];
  const excluded = [];
  for (const repository of found) {
    const name = repository.fullName;
    const owner = name.split("/")[0];
    const reason = repository.isArchived
      ? "archived"
      : repository.isFork
        ? "fork"
        : excludedOwners.has(owner)
          ? "excluded owner (framework or this project)"
          : tuned.has(name)
            ? "used to tune the verifier"
            : excludedNamePattern.test(name) ||
                excludedNamePattern.test(repository.description ?? "")
              ? "template, demo or list by name"
              : null;
    if (reason !== null) {
      excluded.push({ name, reason });
      continue;
    }
    const readme = manifestOf(name, "README.md");
    if (readme === null) {
      excluded.push({ name, reason: "no README.md at the root" });
      continue;
    }
    const manifestText = manifestOf(
      name,
      category.id === "python" ? "pyproject.toml" : "package.json",
    );
    let eligible = false;
    try {
      eligible =
        category.id === "python"
          ? category.manifest(manifestText)
          : category.manifest(JSON.parse(manifestText ?? "null"));
    } catch {
      eligible = false;
    }
    if (!eligible) {
      excluded.push({
        name,
        reason:
          category.id === "python"
            ? "no pyproject with a project table and pytest"
            : "no test script, or not an application with the framework as a dependency",
      });
      continue;
    }
    candidates.push({
      name,
      stars: repository.stargazersCount,
      pushedAt: repository.pushedAt,
      description: repository.description ?? "",
    });
  }
  const order = seededOrder(
    candidates.map((c) => c.name),
    category.id,
  );
  frame.categories.push({
    id: category.id,
    query,
    prerequisites: category.prerequisites,
    found: found.length,
    candidates,
    excluded,
    order,
    selected: order[0] ?? null,
    replacements: [],
  });
  console.log(
    `${category.id}: ${found.length} found, ${candidates.length} eligible, selected ${order[0] ?? "none"}`,
  );
}
writeFileSync(output, `${JSON.stringify(frame, null, 2)}\n`);
console.log(`frame written to ${output}`);
