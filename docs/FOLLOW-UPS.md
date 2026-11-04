# Follow-ups

One line per thing deliberately not done, each of which would change the product's shape, with
why it waits.

- Running checks in a sandbox (a container or a VM per verification) would put the judge's report, the runners' reports, the base-run cache and the sealed store out of reach of the code under test; it waits because it brings back the container runtime and daemon dependency the rebuild removed.
