# v7 falsification battery current state

This document maps the current five-layer v7 battery modules before they are wired into production. The battery is exported from `src/verification/index.ts` (`src/verification/index.ts:1`) and exercised by the synthetic calibration harness, not by the production orchestrator path.

## Layer 1: Differential intent gate

Callable entry point: `runDifferentialGate(input: DifferentialGateInput): Promise<DifferentialGateResult>` (`src/verification/differential-gate.ts:124`).

Inputs: repository path, test command, base commit, agent branch, optional timeout, and optional worktree root (`src/verification/differential-gate.ts:11`). The implementation creates detached worktrees for the base and patch refs (`src/verification/differential-gate.ts:152` and `src/verification/differential-gate.ts:172`) and runs the same command against both with `runVerificationCommand` (`src/verification/differential-gate.ts:156` and `src/verification/differential-gate.ts:173`).

Outputs: `DifferentialGateResult` with `status`, `reason`, optional base and patch command evidence, `durationMs`, and unified `Finding[]` (`src/verification/differential-gate.ts:20`). Failures and invalid tests are converted to summary or line findings through `createFinding` (`src/verification/differential-gate.ts:72` and `src/verification/differential-gate.ts:82`).

Production use: not used in production today. `rg` found uses in tests and in `benchmarks/falsification-corpus/harness.ts`, where the harness calls it as the `intent` layer (`benchmarks/falsification-corpus/harness.ts:130` and `benchmarks/falsification-corpus/harness.ts:138`). README also states the active per-step path is `src/verifier-engine.ts` and the v7 battery is harness-exercised (`README.md:94`).

Dependencies and CI installability: requires `git`, a valid test command, and the target project's test dependencies. It does not declare extra npm dependencies beyond the command runner. CI viability depends on whether the target repository can run the supplied test command in detached worktrees.

## Layer 2: Mutation regression gate

Callable entry point: `runMutationGate(input: MutationGateInput): Promise<MutationGateResult>` (`src/verification/mutation-gate.ts:223`).

Inputs: target repository path, changed files, optional timeout, optional thresholds, and optional command runner (`src/verification/mutation-gate.ts:36`). Thresholds default to `failBelow: 0.6` and `warnBelow: 0.8` (`src/verification/mutation-gate.ts:62`) and can be loaded from `.swarm/gates.yaml` under `verification.mutation` (`src/verification/mutation-gate.ts:86`).

Outputs: `MutationGateResult` with status, reason, mutation score, thresholds, mutant counts, per-tool results, and unified `Finding[]` (`src/verification/mutation-gate.ts:44`). It converts tool output to findings through `buildMutationFindings` (`src/verification/mutation-gate.ts:268`).

Production use: not used in production today. The corpus harness runs it inside the `regression` layer after the normal regression command passes (`benchmarks/falsification-corpus/harness.ts:155`, `benchmarks/falsification-corpus/harness.ts:162`, and `benchmarks/falsification-corpus/harness.ts:182`).

Dependencies and CI installability: supports JavaScript/TypeScript, Python, and Java changed files (`src/verification/mutation-gate.ts:8` and `src/verification/mutation-gate.ts:109`). It shells out to Stryker through `npx stryker run`, mutmut through `python -m mutmut`, and PITest through Gradle or Maven (`src/verification/mutation-gate.ts:139`). These tools are not package dependencies of this repository (`package.json:64` and `package.json:78`); external integration tests install Stryker only when `SWARM_RUN_EXTERNAL_TOOL_TESTS=1` (`test/verification/external-tools.integration.test.ts:75` and `test/verification/external-tools.integration.test.ts:106`). Typical CI must either preinstall or allow installation of these target-language tools.

## Layer 3: Cheat detector

Callable entry point: `runCheatDetector(input: CheatDetectorInput): Promise<CheatDetectorResult>` (`src/verification/cheat-detector.ts:265`).

Inputs: repository path, goal text, optional base and patch refs, optional diff text, allowed test files, optional Semgrep config directory, and a `runSemgrep` flag (`src/verification/cheat-detector.ts:18`). If `diffText` is not supplied, it shells out to `git diff` (`src/verification/cheat-detector.ts:35`).

Outputs: `CheatDetectorResult` with an advisory score, unified cheat findings, and Semgrep status (`src/verification/cheat-detector.ts:29`). The detector builds unified `Finding` objects through `createFinding` (`src/verification/cheat-detector.ts:76`) and scans for hardcoded answers, swallowed exceptions, unauthorized test modifications, complexity mismatch, and mock-only changes (`src/verification/cheat-detector.ts:268`).

Production use: not used in production today. The corpus harness calls it as the `cheat` layer with Semgrep disabled unless requested (`benchmarks/falsification-corpus/harness.ts:200`, `benchmarks/falsification-corpus/harness.ts:208`, and `benchmarks/falsification-corpus/harness.ts:212`).

Dependencies and CI installability: the built-in diff scanners require only Node and Git. Optional Semgrep support looks for `config/semgrep-rules` and runs `semgrep --config ... --json` (`src/verification/cheat-detector.ts:238` and `src/verification/cheat-detector.ts:248`). Semgrep is not a dependency in `package.json`; CI must install it if `runSemgrep` is enabled.

## Layer 4: Property gate

Callable entry point: `runPropertyGate(input: PropertyGateInput): Promise<PropertyGateResult>` (`src/verification/property-gate.ts:212`).

Inputs: target repository path, changed files, optional timeout per function, and optional command runner (`src/verification/property-gate.ts:20`). It discovers supported TypeScript, JavaScript, and Python function targets from changed files (`src/verification/property-gate.ts:40` and `src/verification/property-gate.ts:114`).

Outputs: `PropertyGateResult` with status, score, discovered targets, and unified property findings (`src/verification/property-gate.ts:27`). Counterexamples become line-scoped findings through `createFinding` (`src/verification/property-gate.ts:185`).

Production use: not used in production today. The corpus harness calls it as the `property` layer (`benchmarks/falsification-corpus/harness.ts:222` and `benchmarks/falsification-corpus/harness.ts:229`).

Dependencies and CI installability: generated JS/TS harnesses require `fast-check`; TypeScript harnesses run with `npx tsx`; Python harnesses require Hypothesis (`src/verification/property-gate.ts:125`, `src/verification/property-gate.ts:140`, and `src/verification/property-gate.ts:175`). `tsx` is a dev dependency of this repository, but `fast-check` and Hypothesis are not (`package.json:64`). External integration tests install `fast-check` inside a fixture only when `SWARM_RUN_EXTERNAL_TOOL_TESTS=1` (`test/verification/external-tools.integration.test.ts:119` and `test/verification/external-tools.integration.test.ts:130`). Typical CI must provide the target-language property-test dependencies.

## Layer 5: Attestation

Callable entry points: `generateSignedAttestation(input: AttestationInput): Promise<SignedAttestation>` (`src/verification/attestation.ts:169`), `attachAttestationNote(repoPath, commit, attestation): void` (`src/verification/attestation.ts:185`), and `verifyAttestation(repoPath, commit): Promise<AttestationVerificationResult>` (`src/verification/attestation.ts:226`).

Inputs: attestation generation needs repo path, commit, goal text, plan hash, agent identity, transcript, layer results, composite score, optional timestamp, and optional signer (`src/verification/attestation.ts:20`). Verification needs repo path and commit only (`src/verification/attestation.ts:226`).

Outputs: generation returns a signed in-toto SLSA provenance statement (`src/verification/attestation.ts:33` and `src/verification/attestation.ts:66`). Verification returns `found`, `verified`, `reason`, and optional parsed attestation (`src/verification/attestation.ts:82`). This layer does not currently output unified `Finding[]`, and `FindingProducerId` does not include an attestation producer (`src/types/finding.ts:5`). A production runner will need to represent attestation evidence in `LayerResult` and/or extend the finding schema deliberately.

Production use: only the CLI `swarm attest verify <commit>` calls `verifyAttestation` (`src/cli/attest-handlers.ts:1` and `src/cli/attest-handlers.ts:22`). The orchestrator production run does not generate or attach attestations today. The corpus harness verifies attestations as an advisory layer (`benchmarks/falsification-corpus/harness.ts:242` and `benchmarks/falsification-corpus/harness.ts:244`).

Dependencies and CI installability: default signing uses `cosign sign-blob` (`src/verification/cosign-attestation.ts:34` and `src/verification/cosign-attestation.ts:40`); verification uses `cosign verify-blob` for cosign signatures (`src/verification/cosign-attestation.ts:100` and `src/verification/cosign-attestation.ts:106`). Cosign is not a repository dependency. External integration tests require a `cosign` executable only when `SWARM_RUN_EXTERNAL_TOOL_TESTS=1` (`test/verification/external-tools.integration.test.ts:143` and `test/verification/external-tools.integration.test.ts:145`). Typical CI must install cosign and provide the required signing environment for keyless signing or configure key-based signing.

## Composite scorer

Callable entry point: `computeCompositeScore(input: CompositeScoreInput): CompositeScoreResult` (`src/verification/composite-score.ts:155`).

Inputs: cheat detector score, property gate score, attestation score, optional advisory layer statuses, optional quality gate results, and optional config (`src/verification/composite-score.ts:30`). Config loads from `.swarm/gates.yaml` under `verification.composite` (`src/verification/composite-score.ts:93` and `.swarm/gates.yaml:5`).

Outputs: score, threshold, human-review decision, advisory-trigger flag, advisory penalty, and weighted layer score (`src/verification/composite-score.ts:39`). The default threshold is `0.7`, and default advisory weights are 0.4 cheat detector, 0.4 property gate, and 0.2 attestation (`src/verification/composite-score.ts:48`).

Production use: not used in production today. The corpus harness computes the score after all layers finish (`benchmarks/falsification-corpus/harness.ts:99`).

Integration note: the current scorer is advisory-layer oriented. Hard-gate outcomes from differential and mutation need to gate independently of the advisory composite score, matching the harness behavior where `broke` is set from intent or regression failures (`benchmarks/falsification-corpus/harness.ts:114`).

