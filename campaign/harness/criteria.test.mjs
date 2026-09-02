import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  budgets,
  excludedDirectories,
  excludedFilePatterns,
  excludedOwners,
  extensionsByLanguage,
  installRecipes,
  licenses,
  lines,
  manifests,
  mutationOperators,
  placeholderTestScript,
  quotas,
  repositorySizeMaximumKilobytes,
  sealedOn,
  search,
  searchQuery,
  seedAttemptsMaximum,
  serviceDependencies,
  testCommands,
  total,
  workspaceMarkers,
} from "./criteria.mjs";

const document = await readFile(join(import.meta.dirname, "..", "criteria.md"), "utf8");

/** The document states each value; a value the document does not state is not sealed. */
function stated(value) {
  expect(document, `criteria.md does not state ${JSON.stringify(value)}`).toContain(
    String(value),
  );
}

describe("the sealed criteria and the document agree", () => {
  it("on when they were sealed and how many repositories there are", () => {
    stated(`Sealed on ${sealedOn}`);
    stated(`${total} in all`);
    expect(total).toBe(50);
  });

  it("on the quota per language, as a table row each", () => {
    for (const [language, quota] of Object.entries(quotas)) {
      stated(`| ${language} | ${quota} |`);
    }
  });

  it("on the search query and its bounds", () => {
    stated(`stars:>=${search.minimumStars}`);
    stated(`pushed:>=${search.pushedSince}`);
    stated(`${search.pageSize} per page`);
    expect(searchQuery("Go", "mit")).toBe(
      "language:Go license:mit stars:>=200 pushed:>=2025-01-01 archived:false fork:false",
    );
  });

  it("on the licenses, by identifier and by search keyword", () => {
    for (const [identifier, keyword] of Object.entries(licenses)) {
      stated(identifier);
      stated(`\`${keyword}\``);
    }
  });

  it("on the size bounds and what is counted", () => {
    stated(`Between ${lines.minimum} and ${lines.maximum} non-blank lines`);
    stated(`at most ${repositorySizeMaximumKilobytes} kilobytes`);
    for (const extensions of Object.values(extensionsByLanguage)) {
      for (const extension of extensions) {
        stated(`\`${extension}\``);
      }
    }
    for (const directory of excludedDirectories) {
      stated(`\`${directory}\``);
    }
    for (const pattern of excludedFilePatterns) {
      stated(`\`${pattern.source.replaceAll("\\", "").replace("$", "")}\``);
    }
  });

  it("on the manifests, the test commands and the placeholder", () => {
    for (const [type, manifest] of Object.entries(manifests)) {
      stated(`| \`${manifest}\` | \`${testCommands[type]}\` |`);
    }
    stated(placeholderTestScript);
  });

  it("on the install recipes and the budgets", () => {
    for (const recipe of Object.values(installRecipes.node)) {
      stated(`\`${recipe.join(" ")}\``);
    }
    for (const recipe of [...installRecipes.python, ...installRecipes.go, ...installRecipes.rust]) {
      stated(`\`${recipe.join(" ")}\``);
    }
    for (const extra of installRecipes.pythonOptionalExtras) {
      stated(`\`${extra}\``);
    }
    for (const file of installRecipes.pythonRequirementFiles) {
      stated(`\`${file}\``);
    }
    stated(`within ${budgets.installTimeoutMinutes} minutes`);
    stated(`within ${budgets.suiteTimeoutMinutes} minutes on ${budgets.containerCpus} CPUs`);
    stated(`${budgets.containerMemoryGigabytes} GB of memory`);
  });

  it("on every exclusion", () => {
    for (const owner of excludedOwners) {
      stated(`\`${owner}\``);
    }
    for (const marker of workspaceMarkers) {
      stated(`\`${marker}\``);
    }
    for (const dependency of serviceDependencies) {
      stated(`\`${dependency}\``);
    }
  });

  it("on the seeding rule", () => {
    for (const operator of mutationOperators) {
      stated(`\`${operator}\``);
    }
    stated(`within ${seedAttemptsMaximum} attempts`);
  });
});
