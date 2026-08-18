# Live hardware select, 2026-08-18

## Machine count: one

The gate this closes wants three physical machines. One was available, so one is what
is recorded. The other two are on the external-actions list in the run report, with
the command to run on each. Every profile in the tree before this was synthetic; this
is the first probe output from real hardware.

Machine 1 of 1: Apple M5 Max, 64 GB unified memory, darwin arm64.

## `swarm select`, verbatim

```
hardware
  platform          darwin arm64 (Apple Silicon)
  system memory     64.0 GB
  gpu               Apple M5 Max, 64.0 GB unified memory

shortlist
  source            the snapshot bundled with this release
  revision          2026-08-13
  fell back         https://raw.githubusercontent.com/moonrunnerkc/swarm-orchestrator/main/src/select/coding-models.v1.json could not be read (the server answered 404)

recommendation
  model             mlx-community/Qwen3-Coder-30B-A3B-Instruct-8bit
  backend           rapid-mlx
  weights           30B-A3B at 8-bit, 32.5 GB to download
  context window    262144 tokens
  tier              apple-64gb (Apple Silicon, 64 GB class)

why
  - tier "apple-64gb" (Apple Silicon, 64 GB class) is the highest-ranked tier this machine satisfies.
  - it is for Apple Silicon machines: the probe found darwin/arm64 (Apple M5 Max).
  - it asks for 60.0 GB of system memory: the probe measured 64.0 GB.
  - the next tier up, "apple-128gb" (Apple Silicon, 128 GB class), was ruled out: it asks for 120.0 GB of system memory and the probe measured 64.0 GB.
  - the backend is rapid-mlx: the probe found Apple Silicon, which is what it serves.
  - the shortlist ranks mlx-community/Qwen3-Coder-30B-A3B-Instruct-8bit first among the models in tier "apple-64gb" that fit: it needs about 35.0 GB resident, against 48.0 GB usable, 75% of the 64.0 GB of unified memory the probe measured, leaving 13.0 GB.

run it
  rapid-mlx pull mlx-community/Qwen3-Coder-30B-A3B-Instruct-8bit
  rapid-mlx serve --model mlx-community/Qwen3-Coder-30B-A3B-Instruct-8bit --port 8000
  SWARM_LOCAL_BASE_URL=http://127.0.0.1:8000/v1 swarm --model local:mlx-community/Qwen3-Coder-30B-A3B-Instruct-8bit "your task"

sizes and memory figures above are curated estimates, not measurements of this machine.
```

## Two things in that output worth keeping

**The remote shortlist 404s.** The probe fell back to the snapshot bundled with the
release, revision 2026-08-13, and said so in its own output rather than quietly using
the fallback. The URL it tried is on `main`, which still serves the v12 tree, so the
file is not there yet. This closes itself when the default branch is repointed, and
until then the fallback is the honest behaviour: a stale-but-named snapshot beats a
silent one.

**The last line is the tool's own disclaimer.** The sizes and memory figures in the
recommendation are curated estimates from the shortlist, not measurements of this
machine. What the probe actually measured is the platform, the core count, and the
memory: 64.0 GB, against the tier's 60.0 GB requirement. The 35.0 GB resident figure
for the recommended model is a table value. Any README line built on this has to
carry that split.

## Not run here

The recommendation was not acted on. Pulling a 32.5 GB model to confirm it loads is a
separate item and was not part of this run.
