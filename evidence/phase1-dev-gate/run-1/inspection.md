# Phase 1 dev gate — run-1 hand-inspection

Operator hand-verification of every counter-example codex claimed in
`evidence/phase1-dev-gate/run-1/`. The runner already classified each
candidate as `falsified` (predicate re-ran and exited non-zero) or as
a false positive; this file goes one step further and asks whether
the candidate is *meaningful* — i.e. whether it falsifies the
predicate for the reason the predicate cares about, not because of
an unrelated quirk (malformed file tripping `grep` exit 2, or the
predicate already being false before the candidate was applied).

## ⚠ CONTAMINATION FINDING — 4 obligations invalidated by evidence drift

When run-1 actually executed, four locked predicates were *already*
exit 1 against the snapshot, before any codex candidate was applied.
Cause: earlier aborted-run evidence directories were committed to the
branch before run-1 ran, and several of those evidence files literally
contain the marker tokens the predicates search for (in captured codex
prompts and candidate documents).

Re-verified 2026-05-09 against patch SHA `8f0c323` (the SHA recorded
in `environment.json` for this run): A2, A3, A8, C5 all exit 1 against
a fresh `git archive 8f0c323 | tar -x` snapshot with **no candidate
applied**.

| ID | Target | Cause of contamination |
|----|--------|------------------------|
| A2 | no XXX_FORBIDDEN_TOKEN_PHASE1_GATE marker anywhere in repo | evidence/phase1-dev-gate/run-1-aborted/A2/request.json (and run-1-quota-halted/A2/) contain the literal token XXX_FORBIDDEN_TOKEN_PHASE1_GATE in the captured codex prompt — the prompt embeds the predicate string verbatim. |
| A3 | no PEM RSA private-key header in repo | evidence/phase1-dev-gate/run-1-parser-bug-2/A3/codex-stdout.txt contains the literal "BEGIN RSA PRIVATE KEY" string in codex's candidate documents. |
| A8 | no aws_secret_access_key token in repo | evidence/ subtree contains the literal "aws_secret_access_key" token, almost certainly inside one of the captured codex candidate documents. |
| C5 | no Markdown file at repo root containing 'REDACTED' | a Markdown file at repo root contains the literal token "REDACTED" — most likely run-1-aborted/NOTE.md or run-1-quota-halted/NOTE.md once they were committed at repo root, OR an existing root markdown that was never re-checked. |

### Effect on the gate result

The runner's classification (`runCandidateAgainstPredicate` in
`src/falsification/adapters/codex/predicate-runner.ts`) runs the
predicate once, after applying a candidate. It does not establish a
baseline. If the predicate is already false against the workspace,
any candidate applied on top will also see exit 1 — and the runner
records a "falsification" that was not in fact caused by the
candidate.

Net effect: the 12 candidates across A2 / A3 / A8 / C5 are coincidental,
not causal. They must NOT count toward the gate's confirmed yield.
Treating them as confirmed would inflate the result and contaminate
Phase 2's baseline.

### What the operator should do

Mark each section A2 / A3 / A8 / C5 below as **CONTAMINATED — invalid
evidence**. The remaining 16 obligations' yields are clean and
require the normal hand-inspection (re-run the predicate against a
fresh `git archive HEAD | tar -x` snapshot with the candidate file(s)
written into it; confirm exit non-zero and that the candidate is
the meaningful cause).

Pass criterion arithmetic: even with all 12 contaminated yields
subtracted, run-1 has 36 candidate yields across 12 clean obligations
with predicates that hold pre-apply. Confirming any one of those
still meets the Phase 1 pass criterion ("≥ 1 reproducible real
failure across the 20 obligations").

### Methodological fix for follow-up runs

Two complementary changes the runner should land before any further
runs (Phase 1 iteration or Phase 2 measurement):

1. **Pre-apply baseline check.** Before invoking codex, run the
   predicate against the clean snapshot. If it exits non-zero, that
   obligation is a setup failure — flag and skip; do not bill the
   codex call. This makes contamination visible at the runner level
   instead of having to be caught downstream by hand-audit.
2. **Workspace isolation from the project tree.** Either snapshot a
   commit that pre-dates the evidence/ directory (e.g. v8.0.1's
   `a7e5455`), or use a small purpose-built fixture under
   `evidence/fixtures/` that the gate runs against. The current
   "snapshot HEAD" approach makes the gate re-entrant against its own
   evidence, which is exactly the failure mode A2/A3/A8/C5 surfaced.

Both are out of scope for this hand-inspection. They belong in a
separate commit on the branch (and a DECISIONS.md entry), gated on
whether the operator decides run-1 stands as Phase 1 evidence or a
run-2 against a clean snapshot is required.

---

## How to verify a counter-example (for the 16 clean obligations)

```sh
# from the repo root
id=A1   # change per obligation
tmp=$(mktemp -d)/workspace; mkdir -p "$tmp"
# Use an evidence-free SHA for the snapshot, e.g. 8524d88 (pre-Phase-0)
# or a bespoke commit before any evidence/ landed. Plain HEAD will
# re-trip the contamination problem.
git archive 8524d88 | tar -x -C "$tmp"
# Apply the candidate files (one input at a time) from result.json:
jq -r ".result.inputs[0].files[] | .relPath + \"\\t\" + .bytes" \
  evidence/phase1-dev-gate/run-1/$id/result.json
# write each into "$tmp/<relPath>" then run the reproducer.
cd "$tmp" && eval "$(jq -r .result.inputs[0].reproducer evidence/phase1-dev-gate/run-1/$id/result.json)"; echo "exit=$?"
# OPTIONAL: confirm the same predicate run on the snapshot WITHOUT the
# candidate applied exits 0 (i.e. the predicate genuinely held before).
```

Mark each obligation's yield with **Confirmed real failure** or
**False positive (operator)** as the bold final line.

---

## A1

- Stratum: A
- Target: no eval() in src/falsification
- Predicate: `! grep -rn 'eval(' src/falsification --include='*.ts'`
- Cost: $0.1528 | Wall-clock: 12437 ms

- Codex returned **3 counter-example(s)** (3 confirmed by predicate runner, 0 false positives).

### A1.1

- File(s): `src/falsification/adversarial/direct-eval-call.ts`
  - `src/falsification/adversarial/direct-eval-call.ts` (len=72): `export function run(source: string): unknown {\n  return eval(source);\n}\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: `src/falsification/adversarial/direct-eval-call.ts:2:  return eval(source);\n`
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### A1.2

- File(s): `src/falsification/adversarial/commented-eval-token.ts`
  - `src/falsification/adversarial/commented-eval-token.ts` (len=96): `// Regression fixture: eval("1 + 1") must be detected by the predicate.\nexport const value = 2;\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: `src/falsification/adversarial/commented-eval-token.ts:1:// Regression fixture: eval("1 + 1") must be detected by the predicate.\n`
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### A1.3

- File(s): `src/falsification/adversarial/string-literal-eval-token.ts`
  - `src/falsification/adversarial/string-literal-eval-token.ts` (len=60): `export const forbiddenSnippet = "eval(\"console.log(1)\")";\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: `src/falsification/adversarial/string-literal-eval-token.ts:1:export const forbiddenSnippet = "eval(\"console.log(1)\")";\n`
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

---

## A2  ⚠ CONTAMINATED

- Stratum: A
- Target: no XXX_FORBIDDEN_TOKEN_PHASE1_GATE marker anywhere in repo
- Predicate: `! grep -rn 'XXX_FORBIDDEN_TOKEN_PHASE1_GATE' . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist 2>/dev/null`
- Cost: $0.1447 | Wall-clock: 8826 ms
- Codex returned **counter-example-input**.

**Contamination cause:** evidence/phase1-dev-gate/run-1-aborted/A2/request.json (and run-1-quota-halted/A2/) contain the literal token XXX_FORBIDDEN_TOKEN_PHASE1_GATE in the captured codex prompt — the prompt embeds the predicate string verbatim.

The predicate exits 1 against `git archive 8f0c323 | tar -x` BEFORE any candidate is applied. Codex's candidates may also flip the predicate (or may not), but the runner cannot distinguish that from the pre-existing fail.

- **CONTAMINATED — invalid evidence. All 3 machine-claimed counter-example(s) for A2 are excluded from the confirmed-yield count.**

---

## A3  ⚠ CONTAMINATED

- Stratum: A
- Target: no PEM RSA private-key header in repo
- Predicate: `! grep -rln 'BEGIN RSA PRIVATE KEY' . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist 2>/dev/null`
- Cost: $0.0243 | Wall-clock: 13861 ms
- Codex returned **counter-example-input**.

**Contamination cause:** evidence/phase1-dev-gate/run-1-parser-bug-2/A3/codex-stdout.txt contains the literal "BEGIN RSA PRIVATE KEY" string in codex's candidate documents.

The predicate exits 1 against `git archive 8f0c323 | tar -x` BEFORE any candidate is applied. Codex's candidates may also flip the predicate (or may not), but the runner cannot distinguish that from the pre-existing fail.

- **CONTAMINATED — invalid evidence. All 3 machine-claimed counter-example(s) for A3 are excluded from the confirmed-yield count.**

---

## A4

- Stratum: A
- Target: no console.log( in src/falsification
- Predicate: `! grep -rn 'console\.log(' src/falsification/ --include='*.ts' 2>/dev/null`
- Cost: $0.1514 | Wall-clock: 12513 ms

- Codex returned **3 counter-example(s)** (3 confirmed by predicate runner, 0 false positives).

### A4.1

- File(s): `src/falsification/adversarial/direct-console-log.ts`
  - `src/falsification/adversarial/direct-console-log.ts` (len=85): `export function triggerDirectLog(): void {\n  console.log("predicate should fail");\n}\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: `src/falsification/adversarial/direct-console-log.ts:2:  console.log("predicate should fail");\n`
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### A4.2

- File(s): `src/falsification/adversarial/comment-console-log.ts`
  - `src/falsification/adversarial/comment-console-log.ts` (len=96): `// This comment intentionally contains console.log("matched by grep");\nexport const value = 42;\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: `src/falsification/adversarial/comment-console-log.ts:1:// This comment intentionally contains console.log("matched by grep");\n`
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### A4.3

- File(s): `src/falsification/adversarial/string-console-log.ts`
  - `src/falsification/adversarial/string-console-log.ts` (len=59): `export const snippet = "console.log(\"inside a string\")";\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: `src/falsification/adversarial/string-console-log.ts:1:export const snippet = "console.log(\"inside a string\")";\n`
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

---

## A5

- Stratum: A
- Target: no literal password = ' assignment in src
- Predicate: `! grep -rEn "password = '" src/ --include='*.ts' 2>/dev/null`
- Cost: $0.2509 | Wall-clock: 11720 ms

- Codex returned **3 counter-example(s)** (3 confirmed by predicate runner, 0 false positives).

### A5.1

- File(s): `src/adversarial-password-cases/direct-password-assignment.ts`
  - `src/adversarial-password-cases/direct-password-assignment.ts` (len=100): `export function getPassword(): string {\n  const password = 'hardcoded-secret';\n  return password;\n}\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: `src/adversarial-password-cases/direct-password-assignment.ts:2:  const password = 'hardcoded-secret';\n`
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### A5.2

- File(s): `src/adversarial-password-cases/class-field-password.ts`
  - `src/adversarial-password-cases/class-field-password.ts` (len=114): `export class DemoCredentials {\n  build(): string {\n    let password = 'demo-password';\n    return password;\n  }\n}\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: `src/adversarial-password-cases/class-field-password.ts:3:    let password = 'demo-password';\n`
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### A5.3

- File(s): `src/adversarial-password-cases/comment-password-pattern.ts`
  - `src/adversarial-password-cases/comment-password-pattern.ts` (len=87): `// Example forbidden text: password = 'do-not-commit'\nexport const placeholder = true;\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: `src/adversarial-password-cases/comment-password-pattern.ts:1:// Example forbidden text: password = 'do-not-commit'\n`
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

---

## A6

- Stratum: A
- Target: no // SECURITY: TODO comment in src
- Predicate: `! grep -rn '// SECURITY: TODO' src/ 2>/dev/null`
- Cost: $0.1578 | Wall-clock: 10742 ms

- Codex returned **3 counter-example(s)** (3 confirmed by predicate runner, 0 false positives).

### A6.1

- File(s): `src/adversarial-todo-a/security-marker.ts`
  - `src/adversarial-todo-a/security-marker.ts` (len=94): `export const marker = true;\n// SECURITY: TODO remove this insecure placeholder before release\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: `src/adversarial-todo-a/security-marker.ts:2:// SECURITY: TODO remove this insecure placeholder before release\n`
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### A6.2

- File(s): `src/adversarial-todo-b/notes.md`
  - `src/adversarial-todo-b/notes.md` (len=79): `# Security Review Notes\n\n// SECURITY: TODO audit this path before enabling it.\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: `src/adversarial-todo-b/notes.md:3:// SECURITY: TODO audit this path before enabling it.\n`
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### A6.3

- File(s): `src/adversarial-todo-c/config.json`
  - `src/adversarial-todo-c/config.json` (len=68): `{\n  "reviewNote": "// SECURITY: TODO verify authorization checks"\n}\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: `src/adversarial-todo-c/config.json:2:  "reviewNote": "// SECURITY: TODO verify authorization checks"\n`
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

---

## A7

- Stratum: A
- Target: no Bearer-token literal in src
- Predicate: `! grep -rEn 'Bearer\s+[A-Za-z0-9_-]{20,}' src/ --include='*.ts' 2>/dev/null`
- Cost: $0.1654 | Wall-clock: 24002 ms

- Codex returned **3 counter-example(s)** (3 confirmed by predicate runner, 0 false positives).

### A7.1

- File(s): `src/adversarial-bearer-literals/hardcoded-auth-header.ts`
  - `src/adversarial-bearer-literals/hardcoded-auth-header.ts` (len=71): `export const authorizationHeader = "Bearer ABCDEFGHIJKLMNOPQRST12345";\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: `src/adversarial-bearer-literals/hardcoded-auth-header.ts:1:export const authorizationHeader = "Bearer ABCDEFGHIJKLMNOPQRST12345";\n`
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### A7.2

- File(s): `src/adversarial-bearer-literals/fixture-bearer-token.ts`
  - `src/adversarial-bearer-literals/fixture-bearer-token.ts` (len=104): `export const mockRequest = {\n  headers: {\n    authorization: 'Bearer test_token_1234567890ABCDE'\n  }\n};\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: `src/adversarial-bearer-literals/fixture-bearer-token.ts:3:    authorization: 'Bearer test_token_1234567890ABCDE'\n`
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### A7.3

- File(s): `src/adversarial-bearer-literals/commented-bearer-token.ts`
  - `src/adversarial-bearer-literals/commented-bearer-token.ts` (len=94): `// Example: Authorization: Bearer zyxwvutsrqponmlkjihg_12345\nexport const placeholder = true;\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: `src/adversarial-bearer-literals/commented-bearer-token.ts:1:// Example: Authorization: Bearer zyxwvutsrqponmlkjihg_12345\n`
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

---

## A8  ⚠ CONTAMINATED

- Stratum: A
- Target: no aws_secret_access_key token in repo
- Predicate: `! grep -rin 'aws_secret_access_key' . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist 2>/dev/null`
- Cost: $0.1436 | Wall-clock: 8106 ms
- Codex returned **counter-example-input**.

**Contamination cause:** evidence/ subtree contains the literal "aws_secret_access_key" token, almost certainly inside one of the captured codex candidate documents.

The predicate exits 1 against `git archive 8f0c323 | tar -x` BEFORE any candidate is applied. Codex's candidates may also flip the predicate (or may not), but the runner cannot distinguish that from the pre-existing fail.

- **CONTAMINATED — invalid evidence. All 3 machine-claimed counter-example(s) for A8 are excluded from the confirmed-yield count.**

---

## B1

- Stratum: B
- Target: no .env file at repo root
- Predicate: `! find . -maxdepth 1 -name '.env' -type f 2>/dev/null | grep -q .`
- Cost: $0.1619 | Wall-clock: 18568 ms

- Codex returned **3 counter-example(s)** (3 confirmed by predicate runner, 0 false positives).

### B1.1

- File(s): `.env`
  - `.env` (len=13): `APP_ENV=test\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### B1.2

- File(s): `.env`
  - `.env` (len=53): `DATABASE_URL=postgres://user:pass@localhost:5432/app\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### B1.3

- File(s): `.env`
  - `.env` (len=0): ``
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

---

## B2

- Stratum: B
- Target: no *.key files in repo (excluding node_modules and .git)
- Predicate: `! find . -name '*.key' -not -path './node_modules/*' -not -path './.git/*' 2>/dev/null | grep -q .`
- Cost: $0.1840 | Wall-clock: 20833 ms

- Codex returned **3 counter-example(s)** (3 confirmed by predicate runner, 0 false positives).

### B2.1

- File(s): `adversarial-root-private.key`
  - `adversarial-root-private.key` (len=29): `test private key placeholder\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### B2.2

- File(s): `predicate-inputs/nested-config.key`
  - `predicate-inputs/nested-config.key` (len=39): `configuration key material placeholder\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### B2.3

- File(s): `security-test-empty.key`
  - `security-test-empty.key` (len=0): ``
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

---

## B3

- Stratum: B
- Target: no service-account*.json files in repo
- Predicate: `! find . -name 'service-account*.json' -not -path './node_modules/*' -not -path './.git/*' 2>/dev/null | grep -q .`
- Cost: $0.1627 | Wall-clock: 9207 ms

- Codex returned **3 counter-example(s)** (3 confirmed by predicate runner, 0 false positives).

### B3.1

- File(s): `service-account-test.json`
  - `service-account-test.json` (len=55): `{"type":"service_account","project_id":"test-project"}\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### B3.2

- File(s): `config/service-account-local.json`
  - `config/service-account-local.json` (len=72): `{"client_email":"local@example.invalid","private_key":"not-a-real-key"}\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### B3.3

- File(s): `adversarial-fixtures/service-account-ci.json`
  - `adversarial-fixtures/service-account-ci.json` (len=58): `{"name":"ci fixture","purpose":"predicate falsification"}\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

---

## B4

- Stratum: B
- Target: no symlinks under src/
- Predicate: `! find src/ -type l 2>/dev/null | grep -q .`
- Cost: $0.0417 | Wall-clock: 29703 ms

- Codex returned `no-falsification-found` (reason=`no-counter-example-discovered`, attempts=3, false-positives=3).
- Inspect codex-stdout.txt to see what candidates the model proposed and why none flipped the predicate. Most likely cause for this obligation is a structural-strategy limit (codex cannot describe symlinks via the prompt's `bytes` payload, or cannot fit a sufficiently large file payload inside the per-call output token budget).
- Operator note: 

---

## B5

- Stratum: B
- Target: no *.pem at repo root
- Predicate: `! find . -maxdepth 1 -name '*.pem' -type f 2>/dev/null | grep -q .`
- Cost: $0.1504 | Wall-clock: 9728 ms

- Codex returned **3 counter-example(s)** (3 confirmed by predicate runner, 0 false positives).

### B5.1

- File(s): `adversarial-root-test-key.pem`
  - `adversarial-root-test-key.pem` (len=79): `-----BEGIN TEST PRIVATE KEY-----\nnot-a-real-key\n-----END TEST PRIVATE KEY-----\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### B5.2

- File(s): `adversarial-root-certificate.pem`
  - `adversarial-root-certificate.pem` (len=91): `-----BEGIN CERTIFICATE-----\nVGhpcyBpcyBhIHRlc3QgY2VydGlmaWNhdGUu\n-----END CERTIFICATE-----\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### B5.3

- File(s): `adversarial-empty-root.pem`
  - `adversarial-empty-root.pem` (len=0): ``
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

---

## B6

- Stratum: B
- Target: no source file > 200 KB under src/
- Predicate: `! find src/ -name '*.ts' -size +200k 2>/dev/null | grep -q .`
- Cost: $0.1489 | Wall-clock: 19069 ms

- Codex returned `no-falsification-found` (reason=`no-counter-example-discovered`, attempts=3, false-positives=3).
- Inspect codex-stdout.txt to see what candidates the model proposed and why none flipped the predicate. Most likely cause for this obligation is a structural-strategy limit (codex cannot describe symlinks via the prompt's `bytes` payload, or cannot fit a sufficiently large file payload inside the per-call output token budget).
- Operator note: 

---

## B7

- Stratum: B
- Target: no SSH private-key files (id_rsa/id_dsa/id_ed25519) in repo
- Predicate: `! find . -type f \( -name 'id_rsa' -o -name 'id_dsa' -o -name 'id_ed25519' \) -not -path './node_modules/*' -not -path './.git/*' 2>/dev/null | grep -q .`
- Cost: $0.1456 | Wall-clock: 12133 ms

- Codex returned **3 counter-example(s)** (3 confirmed by predicate runner, 0 false positives).

### B7.1

- File(s): `ssh-key-fixtures-a/id_rsa`
  - `ssh-key-fixtures-a/id_rsa` (len=85): `-----BEGIN OPENSSH PRIVATE KEY-----\nnot-a-real-key\n-----END OPENSSH PRIVATE KEY-----\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### B7.2

- File(s): `security-regression-inputs-b/nested/id_dsa`
  - `security-regression-inputs-b/nested/id_dsa` (len=77): `-----BEGIN DSA PRIVATE KEY-----\nnot-a-real-key\n-----END DSA PRIVATE KEY-----\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### B7.3

- File(s): `credential-check-cases-c/id_ed25519`
  - `credential-check-cases-c/id_ed25519` (len=85): `-----BEGIN OPENSSH PRIVATE KEY-----\nnot-a-real-key\n-----END OPENSSH PRIVATE KEY-----\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

---

## C1

- Stratum: C
- Target: no .ts file under src/falsification over 30 KB
- Predicate: `! find src/falsification -name '*.ts' -size +30k 2>/dev/null | grep -q .`
- Cost: $0.4187 | Wall-clock: 78209 ms

- Codex returned `no-falsification-found` (reason=`no-counter-example-discovered`, attempts=3, false-positives=3).
- Inspect codex-stdout.txt to see what candidates the model proposed and why none flipped the predicate. Most likely cause for this obligation is a structural-strategy limit (codex cannot describe symlinks via the prompt's `bytes` payload, or cannot fit a sufficiently large file payload inside the per-call output token budget).
- Operator note: 

---

## C2

- Stratum: C
- Target: no JSON file at repo root containing 'TODO'
- Predicate: `! find . -maxdepth 1 -name '*.json' -exec grep -l 'TODO' {} + 2>/dev/null | grep -q .`
- Cost: $0.1623 | Wall-clock: 13542 ms

- Codex returned **3 counter-example(s)** (3 confirmed by predicate runner, 0 false positives).

### C2.1

- File(s): `todo-note.json`
  - `todo-note.json` (len=46): `{\n  "note": "TODO: remove this test marker"\n}\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### C2.2

- File(s): `adversarial-config.json`
  - `adversarial-config.json` (len=42): `{\n  "status": "TODO",\n  "enabled": true\n}\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### C2.3

- File(s): `root-todo-fixture.json`
  - `root-todo-fixture.json` (len=40): `[\n  "alpha",\n  "TODO item",\n  "omega"\n]\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

---

## C3

- Stratum: C
- Target: no <script> tag in templates/
- Predicate: `! grep -rln '<script>' templates/ 2>/dev/null | grep -q .`
- Cost: $0.0301 | Wall-clock: 12404 ms

- Codex returned **3 counter-example(s)** (3 confirmed by predicate runner, 0 false positives).

### C3.1

- File(s): `templates/adversarial-literal/index.html`
  - `templates/adversarial-literal/index.html` (len=70): `<!doctype html>\n<html><body><script>alert('x')</script></body></html>\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### C3.2

- File(s): `templates/adversarial-json/payload.json`
  - `templates/adversarial-json/payload.json` (len=78): `{\n  "name": "bad-template",\n  "body": "<script>console.log('bad')</script>"\n}\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

### C3.3

- File(s): `templates/adversarial-docs/example.md`
  - `templates/adversarial-docs/example.md` (len=87): `# Example\n\nThis template includes a forbidden tag:\n\n<script>window.bad = true</script>\n`
- Reproducer exit: 1
- Reproducer stdout/stderr: ``
- Operator re-run verdict: TODO
- Meaningful (falsifies for the predicate's intended reason): TODO
- **TODO: Confirmed real failure / False positive (operator)**

---

## C4

- Stratum: C
- Target: no *.test.ts file under test/falsification over 50 KB
- Predicate: `! find test/falsification -name '*.test.ts' -size +50k 2>/dev/null | grep -q .`
- Cost: $0.0437 | Wall-clock: 34790 ms

- Codex returned `no-falsification-found` (reason=`no-counter-example-discovered`, attempts=3, false-positives=3).
- Inspect codex-stdout.txt to see what candidates the model proposed and why none flipped the predicate. Most likely cause for this obligation is a structural-strategy limit (codex cannot describe symlinks via the prompt's `bytes` payload, or cannot fit a sufficiently large file payload inside the per-call output token budget).
- Operator note: 

---

## C5  ⚠ CONTAMINATED

- Stratum: C
- Target: no Markdown file at repo root containing 'REDACTED'
- Predicate: `! find . -maxdepth 1 -name '*.md' -exec grep -l 'REDACTED' {} + 2>/dev/null | grep -q .`
- Cost: $0.1580 | Wall-clock: 9652 ms
- Codex returned **counter-example-input**.

**Contamination cause:** a Markdown file at repo root contains the literal token "REDACTED" — most likely run-1-aborted/NOTE.md or run-1-quota-halted/NOTE.md once they were committed at repo root, OR an existing root markdown that was never re-checked.

The predicate exits 1 against `git archive 8f0c323 | tar -x` BEFORE any candidate is applied. Codex's candidates may also flip the predicate (or may not), but the runner cannot distinguish that from the pre-existing fail.

- **CONTAMINATED — invalid evidence. All 3 machine-claimed counter-example(s) for C5 are excluded from the confirmed-yield count.**

---

## Aggregate (operator fills in after walking the sections above)

- Counter-examples machine-claimed: 48 across 16 obligations.
- Counter-examples on contaminated predicates (invalid): 12 across A2/A3/A8/C5.
- Counter-examples eligible for confirmation (clean predicates): 36 across 12 obligations.
- Confirmed real failures (operator):  TODO
- False positives (operator):          TODO
- No-falsification-found obligations:  4 (B4, B6, C1, C4) — informative structural-strategy negatives.

### Phase 1 pass criterion

Per `docs/adapter-integration.md` Phase 1: "at least one reproducible
real failure across the 20 obligations." Confirmed-yield ≥ 1 (excluding
the contaminated ones) → pass, proceed to Part D1 (close-out).
Confirmed-yield 0 → Part D2 (iterate strategy once).
