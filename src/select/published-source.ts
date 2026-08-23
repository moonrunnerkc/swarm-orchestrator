/**
 * The ref the curated JSON is served from. It is a branch name inside a URL, not the repository's
 * default branch: pointing HEAD somewhere else leaves this path resolving to whatever the branch
 * it names still holds, which is how both URLs came to answer 404 from the v12 lineage.
 */
export const publishedRef = "v13-main";

/** The raw URL for a file this repository serves directly, by its path in the tree. */
export function publishedFileUrl(pathInTree: string): string {
  return `https://raw.githubusercontent.com/moonrunnerkc/swarm-orchestrator/${publishedRef}/${pathInTree}`;
}
