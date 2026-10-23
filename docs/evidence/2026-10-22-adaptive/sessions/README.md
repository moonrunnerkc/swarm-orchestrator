# Adaptive stage sessions

`adaptive-stage-sessions.tar.xz` (5,922,956 bytes, sha256
`52411347d4e2e3645f016c93389072464f016a7b73ea140f82853ffae20ae965`) holds the study root of the
[adaptive stage](../README.md) as it stood after the held-out block was scored, without the canary
file: every run's configuration, frozen manifest, runner log, launch records, command-log blobs
(OpenCode's event streams among them) and kept Swarm session ledgers with their blobs, for the
smokes, development runs 1 to 3 and both held-out freezes; and `sealed-blobs/`, the command
output of the evaluator author's validation runs. Each Swarm ledger is hash chained and checks
itself.

    shasum -a 256 adaptive-stage-sessions.tar.xz
    mkdir restored && tar -xJf adaptive-stage-sessions.tar.xz -C restored

It is kept on this branch so the main tree keeps the weight headroom its checks require.
