# Follow-ups

One line per thing deliberately not done, each of which would change the product's shape, with
why it waits.

- Running checks in a sandbox (a container or a VM per verification) would put the judge's report, the base-run cache and the sealed store out of reach of the code under test; it waits because it brings back the container runtime and daemon dependency the rebuild removed.
- Judging base runs per test instead of per declared check would tell an inherited failure from an unfixed one inside one suite, which is what kept the verifier from measuring any SWE-bench task in the three-arm evaluation (see "How the runs ended" in docs/results.md); it waits because it needs a reader for every test runner's report format, where the verifier today reads only exit codes.
