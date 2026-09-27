#!/usr/bin/env node
/**
 * One onboarding attempt: fill the observer's configuration with the two public READMEs as
 * published for the version under test, add the one prerequisite a candidate run needs (an
 * npm `tag=next` in the container's user configuration, so `npx swarm-verify` from the README
 * resolves to the prerelease rather than to `latest`; a final run after the stable release
 * sets nothing), and hand it to the observer driver. The filled configuration is written
 * beside the output so the record shows exactly what the observer was given.
 *
 *   node scripts/onboarding/run.mjs <config.json> <output directory> <version> [--candidate]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [configPath, output, version] = process.argv.slice(2);
const candidate = process.argv.includes("--candidate");
if (!configPath || !output || !version) {
  console.error("usage: run.mjs <config.json> <output directory> <version> [--candidate]");
  process.exit(2);
}
mkdirSync(output, { recursive: true });
const config = JSON.parse(readFileSync(configPath, "utf8"));
// The README the registry serves for that version, and the repository's front door at the
// commit the version was built from: the two documents a stranger has.
const packageReadme = execFileSync("npm", ["view", `swarm-verify@${version}`, "readme"], {
  encoding: "utf8",
  maxBuffer: 4_000_000,
});
const source = JSON.parse(
  execFileSync("npm", ["view", `swarm-verify@${version}`, "gitHead", "--json"], {
    encoding: "utf8",
  }).trim() || "null",
);
let frontDoor = "";
try {
  frontDoor = execFileSync("git", ["show", `${source ?? "HEAD"}:README.md`], {
    cwd: resolve(import.meta.dirname, "..", ".."),
    encoding: "utf8",
  });
} catch {
  frontDoor = "";
}
const readme = [
  "--- README of the swarm-verify package on npm ---",
  packageReadme.trim(),
  "",
  "--- README of the swarm-orchestrator repository (front page) ---",
  frontDoor.trim(),
].join("\n");
const filled = {
  ...config,
  version,
  verifierReadme: readme,
  prerequisites: [
    ...config.prerequisites,
    ...(candidate
      ? [
          {
            name: "candidate: npm resolves swarm-verify to the next dist-tag",
            command:
              "mkdir -p /root && printf 'tag=next\\n' >> /root/.npmrc && printf 'tag=next\\n' >> /home/dev/.npmrc",
          },
        ]
      : []),
  ],
};
const filledPath = join(output, "config.filled.json");
writeFileSync(filledPath, `${JSON.stringify(filled, null, 2)}\n`);
console.log(
  `observer configuration written to ${filledPath}; source commit ${source ?? "unknown"}`,
);
execFileSync(process.execPath, [resolve(import.meta.dirname, "observer.mjs"), filledPath, output], {
  stdio: "inherit",
});
