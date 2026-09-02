/**
 * What the acceptance rules read out of a checkout: which manifests are present, what the
 * node test script says, which lockfile the install recipe covers, and the markers of a
 * multi-package tree or a suite that needs a service. Facts only; the rules are in rules.mjs.
 */
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  excludedFiles,
  installRecipes,
  manifests,
  placeholderTestScript,
  serviceDependencies,
  workspaceMarkers,
} from "./criteria.mjs";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** A dependency named in a manifest that is text rather than JSON: quoted, then the name. */
function mentionsDependency(text, name) {
  return text.includes(`"${name}`) || text.includes(`'${name}`) || text.includes(`\t${name} `);
}

export async function readManifestFacts(root) {
  const facts = {
    types: [],
    testScript: null,
    placeholderTest: false,
    lockfile: null,
    workspace: [],
    serviceDependencies: [],
    configuresHarness: false,
  };

  for (const [type, manifest] of Object.entries(manifests)) {
    if (await exists(join(root, manifest))) {
      facts.types.push(type);
    }
  }
  for (const file of excludedFiles) {
    if (await exists(join(root, file))) {
      facts.configuresHarness = true;
    }
  }
  for (const marker of workspaceMarkers) {
    if (await exists(join(root, marker))) {
      facts.workspace.push(marker);
    }
  }

  if (facts.types.includes("node")) {
    const manifest = JSON.parse(await readFile(join(root, manifests.node), "utf8"));
    facts.testScript = typeof manifest.scripts?.test === "string" ? manifest.scripts.test : null;
    facts.placeholderTest = facts.testScript === placeholderTestScript;
    if (manifest.workspaces !== undefined) {
      facts.workspace.push("package.json workspaces");
    }
    for (const lockfile of Object.keys(installRecipes.node)) {
      if (await exists(join(root, lockfile))) {
        facts.lockfile = lockfile;
        break;
      }
    }
    const declared = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
    });
    facts.serviceDependencies.push(...declared.filter((name) => serviceDependencies.includes(name)));
  }

  if (facts.types.includes("python")) {
    const text = await readFile(join(root, manifests.python), "utf8");
    facts.serviceDependencies.push(
      ...serviceDependencies.filter((name) => mentionsDependency(text, name)),
    );
  }

  if (facts.types.includes("rust")) {
    const text = await readFile(join(root, manifests.rust), "utf8");
    if (/^\[workspace\]/m.test(text)) {
      facts.workspace.push("Cargo.toml [workspace]");
    }
  }

  if (facts.types.includes("go")) {
    const text = await readFile(join(root, manifests.go), "utf8");
    facts.serviceDependencies.push(
      ...serviceDependencies.filter((name) => name.includes("/") && text.includes(name)),
    );
  }

  return facts;
}
