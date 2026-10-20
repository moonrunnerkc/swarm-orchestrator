# Every model-powered launch and probe of this work, in order

Each launch is entered here before it starts, with its purpose, build and configuration; its
duration, usage and outcome are filled in after. Readiness sequences are the runner's own, run
inside the launch command before dispatch; they are listed with the launch they preceded, with
their requests and usage apart from the task's. The allowance is one launch of at most 15 minutes,
at most two readiness sequences of at most 90 seconds and three requests each, and twenty minutes
of probe and task wall in all, with no replacement ([protocol.md](protocol.md)). The fixture runs
of [README.md](README.md) section 3 used no model and are not launches.

| # | configuration | build | manifest | started (UTC) | readiness | agent minutes | usage | outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Swarm with `--plan-checks`, `marked-bugfix-www-case` | `826e60e83` (product source `005d5eb8d`; `~/.cache/swarm-comparison/tools/swarm-826e60e83`) | [manifest-plan-checks.json](manifest-plan-checks.json) (`sha256:a440cbd13050...`, `dist/` tree `sha256:4a7d6f655d0c...`, 862 files) | readiness 2026-10-20 04:50:53, launch 04:50:56 | 1 sequence of 2, 3.1 s, `ok`: chat 2.41 s, tool-call 0.47 s, tool-result 0.26 s, all HTTP 200; 753 tokens (721 input, 32 output) | 13.0 (779.9 s) | 3,389,857 tokens (3,361,656 input, 28,201 output), 146 calls, none unanswered | **Hidden oracle pass; product `not accepted`, exit 1; the delivered patch regresses `ftp://`.** The task's example links, `www.` is as upstream, email, `http://`, `HTTP://FOO.COM` and the angle-bracket scheme are as upstream; bare and inline `ftp://` no longer link (the rule spells the scheme `[fF][pP][tT]`). The product's generated check caught that live (`task-diagnostics` failed on a kept case, `Ftp://ftp.example.net/file`), two repair attempts did not change it (max-steps, then the wall), and the run reported the failure. Final verification completed on the delivered tree; the bundle verifies. Readiness, lease and stall watch ran; no stall, no halt. [README.md](README.md) section 6. **Allowance used:** 1 launch, 13.0 agent-minutes, 1 of 2 readiness sequences, 13.1 of 20 minutes of probe and task wall. |
