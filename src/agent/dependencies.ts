import { lockfileInstall } from "swarm-verify/execution";
import type { Chokepoint } from "../tools/chokepoint.ts";

const tail = (text: string) => text.trim().slice(-600);

/** The step that runs install scripts once the packages are in place, by package manager. */
const rebuild = (install: string): string | null =>
  install.startsWith("npm ")
    ? "npm rebuild --foreground-scripts"
    : install.includes("pnpm ")
      ? "corepack pnpm rebuild"
      : null;

/**
 * The base's dependencies, installed in the container the model's commands run in. Fetching is
 * the one stage with the network open, and nothing a package ships runs during it; install
 * scripts run afterwards with the network closed, like any other untrusted code. Returns why the
 * run cannot go on, where the packages could not be fetched, and what to tell the model.
 */
export async function prepareContained(
  chokepoint: Chokepoint,
  workspace: string,
): Promise<{ readonly blocked: string | null; readonly notes: readonly string[] }> {
  const install = await lockfileInstall(workspace, true);
  if (install === null) return { blocked: null, notes: [] };
  const fetched = await chokepoint.check(
    install,
    "install the base's dependencies",
    "dependencies",
  );
  if (fetched.exitCode !== 0)
    return {
      blocked: `the base's dependencies did not install in the container (\`${install}\`): ${tail(fetched.output)}. Fix the dependency it names, or pass --host to work with this machine's installed dependencies, reported as host, not isolated`,
      notes: [],
    };
  const scripts = rebuild(install);
  if (scripts === null) return { blocked: null, notes: [] };
  const built = await chokepoint.check(
    scripts,
    "run the dependencies' install scripts with the network closed",
  );
  return {
    blocked: null,
    notes:
      built.exitCode === 0
        ? []
        : [
            `A dependency's install script failed with the network closed (\`${scripts}\`): ${tail(built.output)}`,
          ],
  };
}
