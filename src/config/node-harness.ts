import { detectProject, type ManifestReader } from "../gates/project-type.ts";

/**
 * The smallest harness the gates can measure a Node project by: node's own test runner, which
 * the coverage and control arms vouch for whole, and nothing that needs installing. Created
 * only in a repository that has no manifest at all, because a manifest the model adds mid-run
 * cannot change what measures the run: the criteria are sealed from the base commit before the
 * model is asked for anything.
 */
export function nodeHarnessFiles(directoryName: string): Readonly<Record<string, string>> {
  const manifest = {
    name: packageNameFrom(directoryName),
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: { test: "node --test" },
  };
  return {
    "package.json": `${JSON.stringify(manifest, null, 2)}\n`,
    ".gitignore": "node_modules/\n",
  };
}

/** The directory's name as npm accepts one: lowercase, one dash between words, nothing else. */
function packageNameFrom(directoryName: string): string {
  const name = directoryName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  return name.length === 0 ? "project" : name;
}

/** Whether any manifest the gates assemble from is present, by the same rule they use. */
export async function hasAnyManifest(read: ManifestReader): Promise<boolean> {
  return (await detectProject(read)).types.length > 0;
}
