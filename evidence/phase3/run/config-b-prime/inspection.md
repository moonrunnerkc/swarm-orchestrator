# Phase 3 inspection — config B' (audit-and-corrections, 2026-05-09)

> **OPERATOR INSPECTION BYPASSED PER EXPLICIT APPROVAL.** Verdicts below are derived from the heuristic AST-based classifier only; no per-candidate operator hand-inspection was performed. See the 2026-05-09 adapter-integration close-out entry in `DECISIONS.md` for the basis decision and the four-ratio Phase 3 ship/freeze accounting that consumes these heuristic-classified counts as bounds (not point estimates).

Operator inspection of every machine-claimed Copilot catch from the Phase 3 ship-B' run. Pre-populated with heuristic AST-based classifications by `scripts/inspection/build-phase3-skeleton.ts`. **Heuristic labels are not authoritative; operator verdict is.**

For each candidate the inspection records: file path + content, reproducer command, reproducer exit code and output, the heuristic label/reason, and the operator verdict (confirmed real failure / predicate-gaming / mechanical false positive). The aggregate section at the bottom rolls the verdicts into confirmed counts the corrected Phase 3 close-out (Part F of the audit) consumes.

Sources: per-obligation `result.json` files at `evidence/phase3/run/config-bp/<id>/result.json` (the ship-B' run); machine-claimed yield = 60 (20 obligations × 3 candidates each).

**Verdict-derivation rules (operator approval bypass):**

- Heuristic `likely-real` → `Confirmed real failure (heuristic-classified, not hand-inspected)`.
- Heuristic `likely-gaming` → `Predicate-gaming (heuristic-classified, not hand-inspected)`.
- Heuristic `ambiguous` → `Ambiguous (treated as likely-real for upper bound, predicate-gaming for lower bound; heuristic-classified, not hand-inspected)`.

## I1 — no-upward-imports in `src/lib1` (stratum I, import-graph-must-satisfy)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### I1 — no-upward-imports in `src/lib1` (stratum I, import-graph-must-satisfy) — candidate 1

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import '../outside'

**Files written by the candidate:**

- `src/lib1/direct-parent-import.ts`

```
import thing from "../outside";

export default thing;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-upward-imports","scope":"src/lib1"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-upward-imports): 1 offender(s); src/lib1/direct-parent-import.ts imports "../outside" (escapes its directory)
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I1 — no-upward-imports in `src/lib1` (stratum I, import-graph-must-satisfy) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import '../../shared/util'

**Files written by the candidate:**

- `src/lib1/nested/grandparent-import.js`

```
import util from "../../shared/util";

export { util };
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-upward-imports","scope":"src/lib1"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-upward-imports): 1 offender(s); src/lib1/nested/grandparent-import.js imports "../../shared/util" (escapes its directory)
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I1 — no-upward-imports in `src/lib1` (stratum I, import-graph-must-satisfy) — candidate 3

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import '../bootstrap'

**Files written by the candidate:**

- `src/lib1/side-effect-upward-import.mts`

```
import "../bootstrap";

export const marker = 1;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-upward-imports","scope":"src/lib1"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-upward-imports): 1 offender(s); src/lib1/side-effect-upward-import.mts imports "../bootstrap" (escapes its directory)
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

## I2 — no-upward-imports in `src/lib2` (stratum I, import-graph-must-satisfy)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### I2 — no-upward-imports in `src/lib2` (stratum I, import-graph-must-satisfy) — candidate 1

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import '../outside'

**Files written by the candidate:**

- `src/lib2/violations/upward-import.ts`

```
import value from "../outside";
export default value;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-upward-imports","scope":"src/lib2"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-upward-imports): 1 offender(s); src/lib2/violations/upward-import.ts imports "../outside" (escapes its directory)
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I2 — no-upward-imports in `src/lib2` (stratum I, import-graph-must-satisfy) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import '../shared'

**Files written by the candidate:**

- `src/lib2/components/bad-import.jsx`

```
import thing from "../shared";
export default function BadImport() {
  return thing;
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-upward-imports","scope":"src/lib2"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-upward-imports): 1 offender(s); src/lib2/components/bad-import.jsx imports "../shared" (escapes its directory)
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I2 — no-upward-imports in `src/lib2` (stratum I, import-graph-must-satisfy) — candidate 3

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import '../escape.js'

**Files written by the candidate:**

- `src/lib2/nested/deeper/break-rule.mjs`

```
import "../escape.js";
export const broken = true;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-upward-imports","scope":"src/lib2"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-upward-imports): 1 offender(s); src/lib2/nested/deeper/break-rule.mjs imports "../escape.js" (escapes its directory)
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

## I3 — no-upward-imports in `src/lib3` (stratum I, import-graph-must-satisfy)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### I3 — no-upward-imports in `src/lib3` (stratum I, import-graph-must-satisfy) — candidate 1

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import '../outside'

**Files written by the candidate:**

- `src/lib3/violates-upward.ts`

```
import thing from "../outside";

export const marker = thing;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-upward-imports","scope":"src/lib3"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-upward-imports): 1 offender(s); src/lib3/violates-upward.ts imports "../outside" (escapes its directory)
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I3 — no-upward-imports in `src/lib3` (stratum I, import-graph-must-satisfy) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import '../../shared'

**Files written by the candidate:**

- `src/lib3/components/BadImport.jsx`

```
import helper from "../../shared";

export default function BadImport() {
  return helper;
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-upward-imports","scope":"src/lib3"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-upward-imports): 1 offender(s); src/lib3/components/BadImport.jsx imports "../../shared" (escapes its directory)
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I3 — no-upward-imports in `src/lib3` (stratum I, import-graph-must-satisfy) — candidate 3

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import '../external.mjs'

**Files written by the candidate:**

- `src/lib3/utils/break-graph.mjs`

```
import data from "../external.mjs";

export const value = data;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-upward-imports","scope":"src/lib3"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-upward-imports): 1 offender(s); src/lib3/utils/break-graph.mjs imports "../external.mjs" (escapes its directory)
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

## I4 — no-upward-imports in `src/lib4` (stratum I, import-graph-must-satisfy)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### I4 — no-upward-imports in `src/lib4` (stratum I, import-graph-must-satisfy) — candidate 1

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import '../helper'

**Files written by the candidate:**

- `src/lib4/violations/upward-import.ts`

```
import helper from "../helper";

export const value = helper;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-upward-imports","scope":"src/lib4"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-upward-imports): 1 offender(s); src/lib4/violations/upward-import.ts imports "../helper" (escapes its directory)
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I4 — no-upward-imports in `src/lib4` (stratum I, import-graph-must-satisfy) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import '../../outside'

**Files written by the candidate:**

- `src/lib4/testcases/nested-breaker.js`

```
import thing from "../../outside";

export default thing;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-upward-imports","scope":"src/lib4"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-upward-imports): 1 offender(s); src/lib4/testcases/nested-breaker.js imports "../../outside" (escapes its directory)
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I4 — no-upward-imports in `src/lib4` (stratum I, import-graph-must-satisfy) — candidate 3

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 2 import edge(s): import 'react', import '../data'

**Files written by the candidate:**

- `src/lib4/components/BrokenView.tsx`

```
import React from "react";
import data from "../data";

export const BrokenView = () => <div>{String(data)}</div>;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-upward-imports","scope":"src/lib4"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-upward-imports): 1 offender(s); src/lib4/components/BrokenView.tsx imports "../data" (escapes its directory)
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

## I5 — no-upward-imports in `src/lib5` (stratum I, import-graph-must-satisfy)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### I5 — no-upward-imports in `src/lib5` (stratum I, import-graph-must-satisfy) — candidate 1

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import '../outside'

**Files written by the candidate:**

- `src/lib5/break-root.ts`

```
import thing from "../outside";

export const value = thing;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-upward-imports","scope":"src/lib5"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-upward-imports): 1 offender(s); src/lib5/break-root.ts imports "../outside" (escapes its directory)
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I5 — no-upward-imports in `src/lib5` (stratum I, import-graph-must-satisfy) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import '../helper.js'

**Files written by the candidate:**

- `src/lib5/nested/break-nested.js`

```
import helper from "../helper.js";

export default helper;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-upward-imports","scope":"src/lib5"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-upward-imports): 1 offender(s); src/lib5/nested/break-nested.js imports "../helper.js" (escapes its directory)
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I5 — no-upward-imports in `src/lib5` (stratum I, import-graph-must-satisfy) — candidate 3

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import '../../config.mjs'

**Files written by the candidate:**

- `src/lib5/deep/inner/break-deep.mts`

```
import config from "../../config.mjs";

export { config };
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-upward-imports","scope":"src/lib5"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-upward-imports): 1 offender(s); src/lib5/deep/inner/break-deep.mts imports "../../config.mjs" (escapes its directory)
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

## I6 — no-cycles in `src/pkg1` (stratum I, import-graph-must-satisfy)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### I6 — no-cycles in `src/pkg1` (stratum I, import-graph-must-satisfy) — candidate 1

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import './cycle-beta'

**Files written by the candidate:**

- `src/pkg1/cycle-alpha.ts`

```
import { beta } from './cycle-beta';

export const alpha = beta + 1;
```

- `src/pkg1/cycle-beta.ts`

```
import { alpha } from './cycle-alpha';

export const beta = alpha + 1;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-cycles","scope":"src/pkg1"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-cycles): src/pkg1/cycle-alpha.ts -> src/pkg1/cycle-beta.ts -> src/pkg1/cycle-alpha.ts
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I6 — no-cycles in `src/pkg1` (stratum I, import-graph-must-satisfy) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import './loop-two'

**Files written by the candidate:**

- `src/pkg1/loop-one.ts`

```
import { two } from './loop-two';

export const one = two + 1;
```

- `src/pkg1/loop-two.ts`

```
import { three } from './loop-three';

export const two = three + 1;
```

- `src/pkg1/loop-three.ts`

```
import { one } from './loop-one';

export const three = one + 1;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-cycles","scope":"src/pkg1"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-cycles): src/pkg1/loop-one.ts -> src/pkg1/loop-two.ts -> src/pkg1/loop-three.ts -> src/pkg1/loop-one.ts
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I6 — no-cycles in `src/pkg1` (stratum I, import-graph-must-satisfy) — candidate 3

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import './a'

**Files written by the candidate:**

- `src/pkg1/c.ts`

```
import { a } from './a';

export const c = a + 1;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-cycles","scope":"src/pkg1"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-cycles): src/pkg1/a.ts -> src/pkg1/b.ts -> src/pkg1/c.ts -> src/pkg1/a.ts
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

## I7 — no-cycles in `src/pkg2` (stratum I, import-graph-must-satisfy)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### I7 — no-cycles in `src/pkg2` (stratum I, import-graph-must-satisfy) — candidate 1

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import './a'

**Files written by the candidate:**

- `src/pkg2/mid.ts`

```
import { a } from './a';

export const mid = a + 10;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-cycles","scope":"src/pkg2"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-cycles): src/pkg2/a.ts -> src/pkg2/mid.ts -> src/pkg2/a.ts
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I7 — no-cycles in `src/pkg2` (stratum I, import-graph-must-satisfy) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import './a'

**Files written by the candidate:**

- `src/pkg2/leaf.ts`

```
import { a } from './a';

export const leaf = a + 1;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-cycles","scope":"src/pkg2"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-cycles): src/pkg2/a.ts -> src/pkg2/mid.ts -> src/pkg2/leaf.ts -> src/pkg2/a.ts
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I7 — no-cycles in `src/pkg2` (stratum I, import-graph-must-satisfy) — candidate 3

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import './cycle-right.js'

**Files written by the candidate:**

- `src/pkg2/cycle-left.js`

```
import { right } from './cycle-right.js';

export const left = right + 1;
```

- `src/pkg2/cycle-right.js`

```
import { left } from './cycle-left.js';

export const right = left + 1;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-cycles","scope":"src/pkg2"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-cycles): src/pkg2/cycle-left.js -> src/pkg2/cycle-right.js -> src/pkg2/cycle-left.js
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

## I8 — no-cycles in `src/pkg3` (stratum I, import-graph-must-satisfy)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### I8 — no-cycles in `src/pkg3` (stratum I, import-graph-must-satisfy) — candidate 1

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import './root'

**Files written by the candidate:**

- `src/pkg3/tail.ts`

```
import { root } from './root';

export const tail = root + 1;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-cycles","scope":"src/pkg3"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-cycles): src/pkg3/root.ts -> src/pkg3/tail.ts -> src/pkg3/root.ts
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I8 — no-cycles in `src/pkg3` (stratum I, import-graph-must-satisfy) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import './cycle-a'

**Files written by the candidate:**

- `src/pkg3/root.ts`

```
import { a } from './cycle-a';

export const root = a;
```

- `src/pkg3/cycle-a.ts`

```
import { b } from './cycle-b';

export const a = b + 1;
```

- `src/pkg3/cycle-b.ts`

```
import { a } from './cycle-a';

export const b = a + 1;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-cycles","scope":"src/pkg3"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-cycles): src/pkg3/cycle-a.ts -> src/pkg3/cycle-b.ts -> src/pkg3/cycle-a.ts
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I8 — no-cycles in `src/pkg3` (stratum I, import-graph-must-satisfy) — candidate 3

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import './loop-first'

**Files written by the candidate:**

- `src/pkg3/root.ts`

```
import { first } from './loop-first';

export const root = first;
```

- `src/pkg3/loop-first.ts`

```
import { second } from './loop-second';

export const first = second + 1;
```

- `src/pkg3/loop-second.ts`

```
import { third } from './loop-third';

export const second = third + 1;
```

- `src/pkg3/loop-third.ts`

```
import { first } from './loop-first';

export const third = first + 1;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-cycles","scope":"src/pkg3"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-cycles): src/pkg3/loop-first.ts -> src/pkg3/loop-second.ts -> src/pkg3/loop-third.ts -> src/pkg3/loop-first.ts
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

## I9 — no-cycles in `src/pkg4` (stratum I, import-graph-must-satisfy)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### I9 — no-cycles in `src/pkg4` (stratum I, import-graph-must-satisfy) — candidate 1

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import './cycle-b'

**Files written by the candidate:**

- `src/pkg4/cycle-a.ts`

```
import { cycleB } from './cycle-b';

export const cycleA = cycleB + 1;
```

- `src/pkg4/cycle-b.ts`

```
import { cycleA } from './cycle-a';

export const cycleB = cycleA + 1;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-cycles","scope":"src/pkg4"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-cycles): src/pkg4/cycle-a.ts -> src/pkg4/cycle-b.ts -> src/pkg4/cycle-a.ts
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I9 — no-cycles in `src/pkg4` (stratum I, import-graph-must-satisfy) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import './start'

**Files written by the candidate:**

- `src/pkg4/end.ts`

```
import { start } from './start';

export const end = start + 1;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-cycles","scope":"src/pkg4"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-cycles): src/pkg4/end.ts -> src/pkg4/start.ts -> src/pkg4/mid.ts -> src/pkg4/end.ts
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I9 — no-cycles in `src/pkg4` (stratum I, import-graph-must-satisfy) — candidate 3

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import './two'

**Files written by the candidate:**

- `src/pkg4/ring/one.ts`

```
import { two } from './two';

export const one = two + 1;
```

- `src/pkg4/ring/two.ts`

```
import { three } from './three';

export const two = three + 1;
```

- `src/pkg4/ring/three.ts`

```
import { one } from './one';

export const three = one + 1;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-cycles","scope":"src/pkg4"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-cycles): src/pkg4/ring/one.ts -> src/pkg4/ring/two.ts -> src/pkg4/ring/three.ts -> src/pkg4/ring/one.ts
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

## I10 — no-cycles in `src/pkg5` (stratum I, import-graph-must-satisfy)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### I10 — no-cycles in `src/pkg5` (stratum I, import-graph-must-satisfy) — candidate 1

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import './alpha'

**Files written by the candidate:**

- `src/pkg5/beta.ts`

```
import { alpha } from './alpha';

export const beta = alpha + 1;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-cycles","scope":"src/pkg5"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-cycles): src/pkg5/alpha.ts -> src/pkg5/beta.ts -> src/pkg5/alpha.ts
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I10 — no-cycles in `src/pkg5` (stratum I, import-graph-must-satisfy) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import './delta'

**Files written by the candidate:**

- `src/pkg5/gamma.ts`

```
import { delta } from './delta';

export const gamma = delta + 1;
```

- `src/pkg5/delta.ts`

```
import { gamma } from './gamma';

export const delta = gamma + 1;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-cycles","scope":"src/pkg5"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-cycles): src/pkg5/delta.ts -> src/pkg5/gamma.ts -> src/pkg5/delta.ts
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### I10 — no-cycles in `src/pkg5` (stratum I, import-graph-must-satisfy) — candidate 3

**Heuristic label:** `likely-real`

**Heuristic reason:** AST contains 1 import edge(s): import './ring-b'

**Files written by the candidate:**

- `src/pkg5/ring-a.ts`

```
import { ringB } from './ring-b';

export const ringA = ringB + 1;
```

- `src/pkg5/ring-b.ts`

```
import { ringC } from './ring-c';

export const ringB = ringC + 1;
```

- `src/pkg5/ring-c.ts`

```
import { ringA } from './ring-a';

export const ringC = ringA + 1;
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"import-graph-must-satisfy","constraint":"no-cycles","scope":"src/pkg5"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
import-graph violation (no-cycles): src/pkg5/ring-a.ts -> src/pkg5/ring-b.ts -> src/pkg5/ring-c.ts -> src/pkg5/ring-a.ts
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

## F1 — `compute(x: number): number` in `src/math/sum.ts` (stratum F, function-must-have-signature)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### F1 — `compute(x: number): number` in `src/math/sum.ts` (stratum F, function-must-have-signature) — candidate 1

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "compute" present but signature drifted: expected `(x: number): number`, observed `(x: string): number`

**Files written by the candidate:**

- `src/math/sum.ts`

```
export function compute(x: string): number {
  return Number(x);
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/math/sum.ts","name":"compute","signature":"(x: number): number"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for compute in src/math/sum.ts does not match; expected "(x:number):number", observed "(x:string):number"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F1 — `compute(x: number): number` in `src/math/sum.ts` (stratum F, function-must-have-signature) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "compute" present but signature drifted: expected `(x: number): number`, observed `(x: number): string`

**Files written by the candidate:**

- `src/math/sum.ts`

```
export function compute(x: number): string {
  return String(x);
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/math/sum.ts","name":"compute","signature":"(x: number): number"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for compute in src/math/sum.ts does not match; expected "(x:number):number", observed "(x:number):string"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F1 — `compute(x: number): number` in `src/math/sum.ts` (stratum F, function-must-have-signature) — candidate 3

**Heuristic label:** `ambiguous`

**Heuristic reason:** no AST-level declaration of "compute" and no trivia mention; candidate may falsify by removing the file or via another mechanism

**Files written by the candidate:**

- `src/math/sum.ts`

```
export function total(x: number): number {
  return x;
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/math/sum.ts","name":"compute","signature":"(x: number): number"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
compute is not declared in src/math/sum.ts; expected signature (x: number): number
```

</details>

**Operator verdict:** [x] Ambiguous (treated as likely-real for upper bound, predicate-gaming for lower bound; heuristic-classified, not hand-inspected)

**Operator notes:**

---

## F2 — `multiply(a: number, b: number): number` in `src/math/product.ts` (stratum F, function-must-have-signature)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### F2 — `multiply(a: number, b: number): number` in `src/math/product.ts` (stratum F, function-must-have-signature) — candidate 1

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "multiply" present but signature drifted: expected `(a: number, b: number): number`, observed `(a: string, b: number): number`

**Files written by the candidate:**

- `src/math/product.ts`

```
export function multiply(a: string, b: number): number {
  return Number(a) * b;
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/math/product.ts","name":"multiply","signature":"(a: number, b: number): number"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for multiply in src/math/product.ts does not match; expected "(a:number,b:number):number", observed "(a:string,b:number):number"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F2 — `multiply(a: number, b: number): number` in `src/math/product.ts` (stratum F, function-must-have-signature) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "multiply" present but signature drifted: expected `(a: number, b: number): number`, observed `(a: number, b: number): string`

**Files written by the candidate:**

- `src/math/product.ts`

```
export function multiply(a: number, b: number): string {
  return String(a * b);
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/math/product.ts","name":"multiply","signature":"(a: number, b: number): number"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for multiply in src/math/product.ts does not match; expected "(a:number,b:number):number", observed "(a:number,b:number):string"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F2 — `multiply(a: number, b: number): number` in `src/math/product.ts` (stratum F, function-must-have-signature) — candidate 3

**Heuristic label:** `ambiguous`

**Heuristic reason:** no AST-level declaration of "multiply" and no trivia mention; candidate may falsify by removing the file or via another mechanism

**Files written by the candidate:**

- `src/math/product.ts`

```
export function product(a: number, b: number): number {
  return a * b;
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/math/product.ts","name":"multiply","signature":"(a: number, b: number): number"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
multiply is not declared in src/math/product.ts; expected signature (a: number, b: number): number
```

</details>

**Operator verdict:** [x] Ambiguous (treated as likely-real for upper bound, predicate-gaming for lower bound; heuristic-classified, not hand-inspected)

**Operator notes:**

---

## F3 — `formatGreeting(name: string): string` in `src/format/greet.ts` (stratum F, function-must-have-signature)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### F3 — `formatGreeting(name: string): string` in `src/format/greet.ts` (stratum F, function-must-have-signature) — candidate 1

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "formatGreeting" present but signature drifted: expected `(name: string): string`, observed `(name: string, excited: boolean): string`

**Files written by the candidate:**

- `src/format/greet.ts`

```
export function formatGreeting(name: string, excited: boolean): string {
  return excited ? `Hello, ${name}!` : `Hello, ${name}.`;
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/format/greet.ts","name":"formatGreeting","signature":"(name: string): string"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for formatGreeting in src/format/greet.ts does not match; expected "(name:string):string", observed "(name:string,excited:boolean):string"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F3 — `formatGreeting(name: string): string` in `src/format/greet.ts` (stratum F, function-must-have-signature) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "formatGreeting" present but signature drifted: expected `(name: string): string`, observed `(name: string): number`

**Files written by the candidate:**

- `src/format/greet.ts`

```
export function formatGreeting(name: string): number {
  return name.length;
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/format/greet.ts","name":"formatGreeting","signature":"(name: string): string"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for formatGreeting in src/format/greet.ts does not match; expected "(name:string):string", observed "(name:string):number"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F3 — `formatGreeting(name: string): string` in `src/format/greet.ts` (stratum F, function-must-have-signature) — candidate 3

**Heuristic label:** `ambiguous`

**Heuristic reason:** no AST-level declaration of "formatGreeting" and no trivia mention; candidate may falsify by removing the file or via another mechanism

**Files written by the candidate:**

- `src/format/greet.ts`

```
export function makeGreeting(name: string): string {
  return `Hello, ${name}!`;
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/format/greet.ts","name":"formatGreeting","signature":"(name: string): string"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
formatGreeting is not declared in src/format/greet.ts; expected signature (name: string): string
```

</details>

**Operator verdict:** [x] Ambiguous (treated as likely-real for upper bound, predicate-gaming for lower bound; heuristic-classified, not hand-inspected)

**Operator notes:**

---

## F4 — `isPositive(x: number): boolean` in `src/predicate/positive.ts` (stratum F, function-must-have-signature)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### F4 — `isPositive(x: number): boolean` in `src/predicate/positive.ts` (stratum F, function-must-have-signature) — candidate 1

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "isPositive" present but signature drifted: expected `(x: number): boolean`, observed `(x: string): boolean`

**Files written by the candidate:**

- `src/predicate/positive.ts`

```
export function isPositive(x: string): boolean {
  return Number(x) > 0;
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/predicate/positive.ts","name":"isPositive","signature":"(x: number): boolean"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for isPositive in src/predicate/positive.ts does not match; expected "(x:number):boolean", observed "(x:string):boolean"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F4 — `isPositive(x: number): boolean` in `src/predicate/positive.ts` (stratum F, function-must-have-signature) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "isPositive" present but signature drifted: expected `(x: number): boolean`, observed `(x: number): number`

**Files written by the candidate:**

- `src/predicate/positive.ts`

```
export function isPositive(x: number): number {
  return x > 0 ? 1 : 0;
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/predicate/positive.ts","name":"isPositive","signature":"(x: number): boolean"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for isPositive in src/predicate/positive.ts does not match; expected "(x:number):boolean", observed "(x:number):number"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F4 — `isPositive(x: number): boolean` in `src/predicate/positive.ts` (stratum F, function-must-have-signature) — candidate 3

**Heuristic label:** `ambiguous`

**Heuristic reason:** no AST-level declaration of "isPositive" and no trivia mention; candidate may falsify by removing the file or via another mechanism

**Files written by the candidate:**

- `src/predicate/positive.ts`

```
export function isNonNegative(x: number): boolean {
  return x >= 0;
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/predicate/positive.ts","name":"isPositive","signature":"(x: number): boolean"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
isPositive is not declared in src/predicate/positive.ts; expected signature (x: number): boolean
```

</details>

**Operator verdict:** [x] Ambiguous (treated as likely-real for upper bound, predicate-gaming for lower bound; heuristic-classified, not hand-inspected)

**Operator notes:**

---

## F5 — `parseInteger(s: string): number` in `src/parse/integer.ts` (stratum F, function-must-have-signature)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### F5 — `parseInteger(s: string): number` in `src/parse/integer.ts` (stratum F, function-must-have-signature) — candidate 1

**Heuristic label:** `ambiguous`

**Heuristic reason:** no AST-level declaration of "parseInteger" and no trivia mention; candidate may falsify by removing the file or via another mechanism

**Files written by the candidate:**

- `src/parse/integer.ts`

```
export function parseIntValue(s: string): number {
  return Number.parseInt(s, 10);
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/parse/integer.ts","name":"parseInteger","signature":"(s: string): number"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
parseInteger is not declared in src/parse/integer.ts; expected signature (s: string): number
```

</details>

**Operator verdict:** [x] Ambiguous (treated as likely-real for upper bound, predicate-gaming for lower bound; heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F5 — `parseInteger(s: string): number` in `src/parse/integer.ts` (stratum F, function-must-have-signature) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "parseInteger" present but signature drifted: expected `(s: string): number`, observed `(s: number): number`

**Files written by the candidate:**

- `src/parse/integer.ts`

```
export function parseInteger(s: number): number {
  return Number.parseInt(String(s), 10);
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/parse/integer.ts","name":"parseInteger","signature":"(s: string): number"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for parseInteger in src/parse/integer.ts does not match; expected "(s:string):number", observed "(s:number):number"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F5 — `parseInteger(s: string): number` in `src/parse/integer.ts` (stratum F, function-must-have-signature) — candidate 3

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "parseInteger" present but signature drifted: expected `(s: string): number`, observed `(s: string): string`

**Files written by the candidate:**

- `src/parse/integer.ts`

```
export function parseInteger(s: string): string {
  return String(Number.parseInt(s, 10));
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/parse/integer.ts","name":"parseInteger","signature":"(s: string): number"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for parseInteger in src/parse/integer.ts does not match; expected "(s:string):number", observed "(s:string):string"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

## F6 — `clamp(x: number, lo: number, hi: number): number` in `src/math/clamp.ts` (stratum F, function-must-have-signature)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### F6 — `clamp(x: number, lo: number, hi: number): number` in `src/math/clamp.ts` (stratum F, function-must-have-signature) — candidate 1

**Heuristic label:** `ambiguous`

**Heuristic reason:** no AST-level declaration of "clamp" and no trivia mention; candidate may falsify by removing the file or via another mechanism

**Files written by the candidate:**

- `src/math/clamp.ts`

```
export function bound(x: number, lo: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/math/clamp.ts","name":"clamp","signature":"(x: number, lo: number, hi: number): number"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
clamp is not declared in src/math/clamp.ts; expected signature (x: number, lo: number, hi: number): number
```

</details>

**Operator verdict:** [x] Ambiguous (treated as likely-real for upper bound, predicate-gaming for lower bound; heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F6 — `clamp(x: number, lo: number, hi: number): number` in `src/math/clamp.ts` (stratum F, function-must-have-signature) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "clamp" present but signature drifted: expected `(x: number, lo: number, hi: number): number`, observed `(x: number, lo: string, hi: number): number`

**Files written by the candidate:**

- `src/math/clamp.ts`

```
export function clamp(x: number, lo: string, hi: number): number {
  const lower = Number(lo);
  if (x < lower) return lower;
  if (x > hi) return hi;
  return x;
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/math/clamp.ts","name":"clamp","signature":"(x: number, lo: number, hi: number): number"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for clamp in src/math/clamp.ts does not match; expected "(x:number,lo:number,hi:number):number", observed "(x:number,lo:string,hi:number):number"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F6 — `clamp(x: number, lo: number, hi: number): number` in `src/math/clamp.ts` (stratum F, function-must-have-signature) — candidate 3

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "clamp" present but signature drifted: expected `(x: number, lo: number, hi: number): number`, observed `(x: number, lo: number, hi: number): string`

**Files written by the candidate:**

- `src/math/clamp.ts`

```
export function clamp(x: number, lo: number, hi: number): string {
  if (x < lo) return String(lo);
  if (x > hi) return String(hi);
  return String(x);
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/math/clamp.ts","name":"clamp","signature":"(x: number, lo: number, hi: number): number"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for clamp in src/math/clamp.ts does not match; expected "(x:number,lo:number,hi:number):number", observed "(x:number,lo:number,hi:number):string"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

## F7 — `toUpper(s: string): string` in `src/format/upper.ts` (stratum F, function-must-have-signature)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### F7 — `toUpper(s: string): string` in `src/format/upper.ts` (stratum F, function-must-have-signature) — candidate 1

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "toUpper" present but signature drifted: expected `(s: string): string`, observed `(s: number): string`

**Files written by the candidate:**

- `src/format/upper.ts`

```
export function toUpper(s: number): string {
  return String(s).toUpperCase();
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/format/upper.ts","name":"toUpper","signature":"(s: string): string"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for toUpper in src/format/upper.ts does not match; expected "(s:string):string", observed "(s:number):string"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F7 — `toUpper(s: string): string` in `src/format/upper.ts` (stratum F, function-must-have-signature) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "toUpper" present but signature drifted: expected `(s: string): string`, observed `(s: string): number`

**Files written by the candidate:**

- `src/format/upper.ts`

```
export function toUpper(s: string): number {
  return s.toUpperCase().length;
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/format/upper.ts","name":"toUpper","signature":"(s: string): string"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for toUpper in src/format/upper.ts does not match; expected "(s:string):string", observed "(s:string):number"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F7 — `toUpper(s: string): string` in `src/format/upper.ts` (stratum F, function-must-have-signature) — candidate 3

**Heuristic label:** `ambiguous`

**Heuristic reason:** no AST-level declaration of "toUpper" and no trivia mention; candidate may falsify by removing the file or via another mechanism

**Files written by the candidate:**

- `src/format/upper.ts`

```
export function upperCase(s: string): string {
  return s.toUpperCase();
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/format/upper.ts","name":"toUpper","signature":"(s: string): string"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
toUpper is not declared in src/format/upper.ts; expected signature (s: string): string
```

</details>

**Operator verdict:** [x] Ambiguous (treated as likely-real for upper bound, predicate-gaming for lower bound; heuristic-classified, not hand-inspected)

**Operator notes:**

---

## F8 — `square(x: number): number` in `src/math/square.ts` (stratum F, function-must-have-signature)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### F8 — `square(x: number): number` in `src/math/square.ts` (stratum F, function-must-have-signature) — candidate 1

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "square" present but signature drifted: expected `(x: number): number`, observed `(x: string): number`

**Files written by the candidate:**

- `src/math/square.ts`

```
export function square(x: string): number {
  const n = Number(x);
  return n * n;
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/math/square.ts","name":"square","signature":"(x: number): number"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for square in src/math/square.ts does not match; expected "(x:number):number", observed "(x:string):number"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F8 — `square(x: number): number` in `src/math/square.ts` (stratum F, function-must-have-signature) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "square" present but signature drifted: expected `(x: number): number`, observed `(x: number): string`

**Files written by the candidate:**

- `src/math/square.ts`

```
export function square(x: number): string {
  return String(x * x);
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/math/square.ts","name":"square","signature":"(x: number): number"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for square in src/math/square.ts does not match; expected "(x:number):number", observed "(x:number):string"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F8 — `square(x: number): number` in `src/math/square.ts` (stratum F, function-must-have-signature) — candidate 3

**Heuristic label:** `ambiguous`

**Heuristic reason:** no AST-level declaration of "square" and no trivia mention; candidate may falsify by removing the file or via another mechanism

**Files written by the candidate:**

- `src/math/square.ts`

```
export function squared(x: number): number {
  return x * x;
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/math/square.ts","name":"square","signature":"(x: number): number"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
square is not declared in src/math/square.ts; expected signature (x: number): number
```

</details>

**Operator verdict:** [x] Ambiguous (treated as likely-real for upper bound, predicate-gaming for lower bound; heuristic-classified, not hand-inspected)

**Operator notes:**

---

## F9 — `concat(a: string, b: string): string` in `src/format/concat.ts` (stratum F, function-must-have-signature)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### F9 — `concat(a: string, b: string): string` in `src/format/concat.ts` (stratum F, function-must-have-signature) — candidate 1

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "concat" present but signature drifted: expected `(a: string, b: string): string`, observed `(a: string, b: number): string`

**Files written by the candidate:**

- `src/format/concat.ts`

```
export function concat(a: string, b: number): string {
  return a + String(b);
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/format/concat.ts","name":"concat","signature":"(a: string, b: string): string"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for concat in src/format/concat.ts does not match; expected "(a:string,b:string):string", observed "(a:string,b:number):string"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F9 — `concat(a: string, b: string): string` in `src/format/concat.ts` (stratum F, function-must-have-signature) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "concat" present but signature drifted: expected `(a: string, b: string): string`, observed `(a: string, b: string): string[]`

**Files written by the candidate:**

- `src/format/concat.ts`

```
export function concat(a: string, b: string): string[] {
  return [a, b];
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/format/concat.ts","name":"concat","signature":"(a: string, b: string): string"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for concat in src/format/concat.ts does not match; expected "(a:string,b:string):string", observed "(a:string,b:string):string[]"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F9 — `concat(a: string, b: string): string` in `src/format/concat.ts` (stratum F, function-must-have-signature) — candidate 3

**Heuristic label:** `ambiguous`

**Heuristic reason:** no AST-level declaration of "concat" and no trivia mention; candidate may falsify by removing the file or via another mechanism

**Files written by the candidate:**

- `src/format/concat.ts`

```
export function join(a: string, b: string): string {
  return a + b;
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/format/concat.ts","name":"concat","signature":"(a: string, b: string): string"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
concat is not declared in src/format/concat.ts; expected signature (a: string, b: string): string
```

</details>

**Operator verdict:** [x] Ambiguous (treated as likely-real for upper bound, predicate-gaming for lower bound; heuristic-classified, not hand-inspected)

**Operator notes:**

---

## F10 — `negate(x: number): number` in `src/math/negate.ts` (stratum F, function-must-have-signature)

Machine-claimed yield: 3 (cost record reports counterExamplesFound=3, falsePositives=0).

### F10 — `negate(x: number): number` in `src/math/negate.ts` (stratum F, function-must-have-signature) — candidate 1

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "negate" present but signature drifted: expected `(x: number): number`, observed `(x: string): number`

**Files written by the candidate:**

- `src/math/negate.ts`

```
export function negate(x: string): number {
  return -Number(x);
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/math/negate.ts","name":"negate","signature":"(x: number): number"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for negate in src/math/negate.ts does not match; expected "(x:number):number", observed "(x:string):number"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F10 — `negate(x: number): number` in `src/math/negate.ts` (stratum F, function-must-have-signature) — candidate 2

**Heuristic label:** `likely-real`

**Heuristic reason:** declaration of "negate" present but signature drifted: expected `(x: number): number`, observed `(x: number): string`

**Files written by the candidate:**

- `src/math/negate.ts`

```
export function negate(x: number): string {
  return String(-x);
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/math/negate.ts","name":"negate","signature":"(x: number): number"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
signature for negate in src/math/negate.ts does not match; expected "(x:number):number", observed "(x:number):string"
```

</details>

**Operator verdict:** [x] Confirmed real failure (heuristic-classified, not hand-inspected)

**Operator notes:**

---

### F10 — `negate(x: number): number` in `src/math/negate.ts` (stratum F, function-must-have-signature) — candidate 3

**Heuristic label:** `ambiguous`

**Heuristic reason:** no AST-level declaration of "negate" and no trivia mention; candidate may falsify by removing the file or via another mechanism

**Files written by the candidate:**

- `src/math/negate.ts`

```
export function invert(x: number): number {
  return -x;
}
```

**Reproducer:** `node -e "const {verifyObligation}=require('./dist/src/verification/run-verifier');console.log(JSON.stringify(verifyObligation({"type":"function-must-have-signature","file":"src/math/negate.ts","name":"negate","signature":"(x: number): number"},{repoRoot:process.cwd()})))"`

**Reproducer exit:** 1

<details><summary>Reproducer output</summary>

```
negate is not declared in src/math/negate.ts; expected signature (x: number): number
```

</details>

**Operator verdict:** [x] Ambiguous (treated as likely-real for upper bound, predicate-gaming for lower bound; heuristic-classified, not hand-inspected)

**Operator notes:**

---

## Aggregate

- Machine-claimed catches: 60
- Heuristic likely-real: 50
- Heuristic likely-gaming: 0
- Heuristic ambiguous: 10
- Operator hand-inspection: BYPASSED PER EXPLICIT APPROVAL (see banner above and the 2026-05-09 close-out entry in `DECISIONS.md`).
- Heuristic-derived verdicts (substituted for operator verdicts):
  - Confirmed real failure (heuristic-classified, not hand-inspected): **50**.
  - Predicate-gaming (heuristic-classified, not hand-inspected): **0**.
  - Ambiguous (treated as likely-real for upper bound, predicate-gaming for lower bound; heuristic-classified, not hand-inspected): **10**.
  - Mechanical false positives: **0** (heuristic classifier emitted none; not separately confirmed).

**Heuristic-derived bounds (consumed by the corrected Phase 3 close-out):**

- **Lower bound (heuristic-confirmed):** 50 — likely-real verdicts only; ambiguous candidates discarded.
- **Upper bound (heuristic-confirmed):** 60 — likely-real plus all ambiguous candidates treated as real.
- **Bracket width:** 10, the count of ambiguous candidates.

**Conservation check:** machine-claimed (60) === sum(heuristic-derived categories) (50 likely-real + 0 likely-gaming + 10 ambiguous + 0 mechanical FP) = 60. **PASSES.**

**Epistemic caveat.** These counts rest on a heuristic classifier (`src/falsification/inspection/heuristic-classifier.ts`), not on per-candidate hand inspection. The classifier is AST-based with documented heuristics; it is not a substitute for operator adjudication. The corrected Phase 3 close-out reads these as bounds, not point estimates, and reports the four-ratio accounting accordingly.

## Provenance

- Heuristic classifier: `src/falsification/inspection/heuristic-classifier.ts` (real tests at `test/falsification/inspection/heuristic-classifier.test.ts`).
- Skeleton generator: `scripts/inspection/build-phase3-skeleton.ts`.
- Source artefacts: `evidence/phase3/run/config-bp/<id>/result.json` (20 obligations × 3 candidates = 60).
