# Follow-ups

One line per thing deliberately not done, each of which would change the product's shape, with
why it waits.

- Running checks in a sandbox (a container or a VM per verification) would put the judge's report, the runners' reports, the base-run cache and the sealed store out of reach of the code under test; it waits because it brings back the container runtime and daemon dependency the rebuild removed.
- Once a swarm-verify release carries `fix/structure-text-absent`, name the `{"path", "contains", "absent": true}` claim in the agent's requirement form (`src/agent/prompt.ts`) and render it in `src/agent/requirement-lines.ts`; 2.0.3 reads that claim as "the path is gone", so it waits for the release.
