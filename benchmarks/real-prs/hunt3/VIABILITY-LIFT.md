# Viability lift over the 27 frozen wild entries

What Phase 1 changed about how many wild entries the execution-grounded tier can
run on, with the real command output behind every entry that moved. The census
(`VIABILITY-CENSUS.md`, committed first as the roadmap) is the "before"; this is
the "after," and every entry that stayed out is recorded with its honest reason.

Regenerate: `npm run viability-census` (screen), then
`SWARM_EG_NODE_BIN=/path/to/node@22/bin node dist/scripts/real-prs/hunt3-provision-proof.js`
(clone + install proof). Outputs: `viability-census.json`, `provision-proof.json`.

## Two surfaces, kept apart

The proof tier (restoration engines + claim-differential) is Node-only; it
fail-closed abstains on a pytest or Go runner. So "install-viable" (can be
cloned and installed) and "proof-executable" (the Node tier can actually run)
are different counts, and this report never blends them.

| surface | before (frozen dataset / frontier screen) | after Phase 1 | delta |
| --- | --- | --- | --- |
| proof-executable (Node tier runs) | 6 | 7 | **+1** (outline) |
| install-viable (screen accepts) | 13 (6 Node + 5 pytest + 2 Go) | 14 | **+1** (outline) |
| provisioned (of the Node proof-executable set) | 4 of 6 | 6 of 7 | **+2** (flight-planner, outline; inmanta still fails) |

The dataset's frozen `egViable: 6` counts the proof-executable Node repos. The
frontier run had already lifted install-viability to 13 by wiring pytest and Go
install; that did not add proof-executability because the tier is Node-only. This
run adds one proof-executable entry and fixes two install failures.

## The three entries that moved, with command output

### outline/outline#12197 — false-negative flipped to viable AND provisioned

The screen rejected it with `node engine ">=20.12 <21 || 22 || 24" excludes 22`.
That range explicitly admits Node 22 via its `|| 22` clause; the screen treated
the first `<21` as a global upper bound. Fixed in `nodeSatisfiable` /
`nodeEngineSatisfiable` by splitting on `||` and admitting when any alternative
admits the pinned major (commit `701e6292`; unit-tested against synthetic engine
strings, not against outline). The screen now returns
`viable: Node + lockfile + runner + node engine OK`, and the real sandbox
provisioner clones and installs it:

```
provisioned: outline/outline (pm=yarn, runner=jest)
```

(`provision-proof.json`, run under `SWARM_EG_NODE_BIN=node@22`.) This is the +1
proof-executable and +1 provisioned.

### yorickdewid/flight-planner#149 — install failure fixed, now provisioned

Already screen-viable (pnpm + jest), but Hunt 3 recorded it `not-provisioned`.
Root cause (clean-sandbox reproduce): the frozen `pnpm install --frozen-lockfile`
resolved and linked every dependency, then the repo's own `prepare` script ran
`pnpm run build` and died with `sh: 1: pnpm: not found` — the sandbox PATH had
the pinned Node bin dir but no pnpm entrypoint. Fixed by prepending a corepack
pnpm/yarn shim dir to the sandbox PATH (commit `51493b4c`). The real provisioner
now completes:

```
provisioned: yorickdewid/flight-planner (pm=pnpm, runner=jest)
```

### inmanta/web-console#6972 — stays not-provisioned, honest reason

Screen-viable (yarn + vitest), but the install genuinely cannot complete on
anonymous access. The exact failure in a clean sandbox:

```
YN0041: @joint/plus@npm:4.2.3::__archiveUrl=https%3A%2F%2Fnpm.jointjs.com%2F...:
        Invalid authentication (as an anonymous user)
➤ YN0000: · Failed with errors
```

`@joint/plus` is served from JointJS's private/paid registry (`npm.jointjs.com`)
and requires a license credential we do not have. This is not a tool defect and
not recipe-fixable: a mutation recipe may change env and config to let the suite
start, but it cannot mint a paid-registry credential, and doing so would also
cross the "change whether it starts, never what runs" line. Recorded as a real
install failure, exactly as Hunt 2 and Hunt 3 did. Both the frozen and non-frozen
install attempts fail identically (`provision-proof.json`, `provisioned: false`,
`errorCode: sandbox-install-failed`).

## Every entry that stayed out, and why

The 20 entries that are not proof-executable after Phase 1, grouped by root cause.
None was forced; each reason is what the screen or a bounded structural probe
actually found.

**Install-viable but proof tier is Node-only (7).** canvas-hyperscribe, algebench,
jaseci, skyvern, ktir-cpu (all pytest); initech, mdsmith (Go). The sandbox clones
and installs these, but the restoration and claim-differential proofs are
TS/Node-specific and fail-closed abstain on a non-Node runner. Extending the proof
tier to Python or Go is a large, separate effort recorded as future work in
`polyglot-install.ts`, not a provisioner change.

**Monorepo with a Node subpackage but no lockfile (4).** MechanicBuddy
(`frontend/`, `management-portal/`), sf-bulk-loader (`electron/`, `frontend/`,
`infrastructure/`), odoo-custom (`infra/backup-runner/`), markethawk (`frontend/`).
A blobless tree probe found the Node subpackage manifests, but none ships a
committed lockfile. Frozen-lockfile discipline (a hard rule) refuses an install
with no lockfile to freeze, so a workspace-subpackage provisioner could not
produce a reproducible install here. In three of the four the maintainer complaint
also lands on the Python/.NET part, not the Node subpackage, so even a relaxed
install would not reach the accused code.

**Unsupported language or non-project layout (5).** aura (Rust workspace), pigsty
(Ansible/YAML/Terraform), microsoft/testfx (.NET/C#), Nexus-AI-Build (Python
subdirs with no pytest signal), ctf-archive (a monorepo of unrelated CTF
challenges, no single provisionable project). No supported test tier applies.

**Node but genuinely no test runner (2).** quirgs (`scripts.test` absent, no
runner dep — an Astro/wrangler app), velocityos (`scripts.test` is literally
`echo "no root tests yet" && exit 0`). There is nothing to execute; forcing
viability here would fabricate a runnable suite that does not exist.

**Python project, no pytest signal at root (1).** clingcon is a C++/CMake project
carrying a `pyproject.toml` shim for its Python bindings; the tests are C++ under
CMake, which no supported tier runs.

**Repo or PR head gone (1).** flipflowglobal/D.L#47 returns HTTP 404 for its head
SHA (repo deleted, made private, or the PR head GC'd). Unreachable, recorded.

## Bottom line

Proof-executable surface 6 → 7, provisioned 4 → 6 of 7. The lift is one genuine
false-negative corrected and one install-path defect fixed, both validated by real
clone-and-install output. The corpus's ceiling is structural: it is dominated by
non-Node and non-project repositories the Node proof tier cannot execute on, and
that is stated plainly rather than papered over.

---

## Close-out 2026-07-08 (soundness run): the census stops being an open item

Read the census (`VIABILITY-CENSUS.md`), then looked for a remaining category with
a bounded, honest provisioner path covering two or more entries, under this run's
hard rules (no paid registries, no recipe that changes what runs, no new proof
tier). There is none, so this is the itemized close-out.

**Executable surface: 7 of 27** (proof-executable, the Node proof tier can run):
inmanta/web-console#6972, lesmartiepants/poetry-bil-araby#545,
myhuemungusD/SkateHubba-play#382, outline/outline#12197,
yorickdewid/flight-planner#149, vitejs/vite-plugin-react#1246, cybersemics/em#4339.
Provisioned 6 of the 7 (inmanta fails on a paid private registry).

**The 20 outside the surface, per category, with the honest reason a provisioner
cannot honestly reach them:**

| category | n | why no bounded provisioner (within scope) |
| --- | --- | --- |
| install-viable pytest/Go | 7 | These provision already; the proof tier (restoration + claim-differential) is Node-only and fail-closed abstains on a pytest/Go runner. Reaching them needs a Python/Go PROOF TIER, a new capability, not a provisioner. This run ships no new capability except the discrimination control, so it is out of scope and recorded as future work in `polyglot-install.ts`. |
| monorepo Node subpackage, no lockfile | 4 | Frozen-lockfile discipline (a hard rule) refuses an install with no committed lockfile; generating one would change what resolves and runs (forbidden). In 3 of 4 the maintainer complaint lands on the Python/.NET part, not the Node subpackage, so even a relaxed install would not reach the accused code. |
| unsupported language / non-project | 5 | Rust workspace, Ansible/YAML/Terraform, .NET/C#, Python-no-pytest subdirs, and a monorepo of unrelated CTF challenges. No supported test tier applies; a provisioner has nothing to provision honestly. |
| Node, genuinely no test runner | 2 | quirgs (no `scripts.test`, no runner dep) and velocityos (`scripts.test` is `echo "no root tests yet" && exit 0`). Forcing viability would fabricate a suite that does not exist. |
| Python, no pytest signal at root | 1 | clingcon is a C++/CMake project with a `pyproject.toml` shim; the tests are C++ under CMake, which no supported tier runs. |
| repo or PR head gone | 1 | flipflowglobal/D.L#47 returns HTTP 404 for its head SHA. Unreachable. |

**Conclusion.** The corpus ceiling is structural: 7/27 are Node-proof-executable,
and the dominant blocker (7 entries) is the Node-only proof tier, not provisioning.
No category outside the surface has a bounded, honest provisioner path that this
run's scope permits, so no provisioner was implemented. The single highest-value
lift is a Python/Go proof tier (7 entries), recorded as out-of-scope future work.
The census is closed as an open item: every entry has an itemized, honest reason,
and the executable surface number (7/27) is stable.
