# Follow-ups

One line per thing deliberately not done, each of which would change the product's shape, with
why it waits.

- Running checks in a sandbox (a container or a VM per verification) would put the judge's report, the runners' reports, the base-run cache and the sealed store out of reach of the code under test; it waits because it brings back the container runtime and daemon dependency the rebuild removed.
- An edit whose SEARCH part differs from the file only in indentation or blank lines is refused and the file's lines shown; applying it would need the replacement re-indented to match, which is wrong for a language where indentation carries meaning unless done per language. It waits on a rule that is safe for Python.
- The time rule sizes the next turn by the longest turn so far, so one slow reply can end a run with minutes left; sizing by a typical turn waits on live runs that show it does not overrun the time kept for final verification.
- A repository whose typecheck or build already fails at the base is reported `regression unresolved` by swarm-verify 3.1.0 whatever the change; the fix (comparing diagnostics) is on moonrunnerkc/swarm-verify#6 and waits on a verifier release, after which the dependency range here moves to it.
- The checks that decide whether a drafted test is usable (`src/agent/authored-validation.ts`) still read runner output by pattern in places; moving them onto the runners' structured reports throughout waits because it changes which drafts are admitted and needs its own live comparison.
- A base whose dependencies cannot install in the container (a platform-only package) is reported blocked only at the first verification, after the model has worked; probing the install before the first turn waits because it adds the install's time to every run that would have passed.
