# Separate held-out campaign plan

Status: not launched; task/evaluator preparation remains. The local development trial cannot
answer broad superiority. Do not substitute its exposed tasks for this portfolio.

Target 20 tasks, four per repository, one in each family: bug fix, feature, behavior-preserving
refactor, API/dependency compatibility. Candidate repositories: pallets/click, python-attrs/attrs,
pytest-dev/pluggy (Python), sindresorhus/p-limit and fastify/fastify (JavaScript/TypeScript),
plus sindresorhus/p-queue for the unfilled p-limit refactor slot.
These are selection targets, not claims that their tasks have passed exposure or feasibility checks.
At least ten tasks must require meaningful changes in multiple authored files.

Select by a dated public issue/commit window and fixed ordering before reading solutions. Exclude
all task identities or equivalents in repository evidence, old campaign manifests, transcripts,
model calibration and this session. Record rejected candidates and reasons; public training-set
contamination remains unknown. Freeze exact bases, task text and deliverables; keep upstream
patches and hidden checks outside worker access. A separate evaluator author must validate each
obligation against base failures, a correct reference, plausible alternative correct implementations
where available, and faulty controls. Evaluate preserved behavior beyond prompt examples.
If any evaluator feedback guides product changes, reclassify that task as development.

Register repeated runs on task positions 1 and 3 in each repository before any result: three total
runs each, one on the other positions. This gives 40 invocations per arm. Compare original Swarm,
revised Swarm and a simple same-model coding loop separately from stable OpenCode and Claude Code.
That is 200 invocations for one model/configuration layer; a second same-model layer for the first
three arms adds 120. At nine minutes each, ceiling 48 agent-hours plus preparation and independent
scoring. No cloud cost is authorized. Longer budgets may be needed for meaningful multi-file work;
that decision must precede execution and changes the estimate. A full campaign cannot be inferred
from the eight-slot development allowance.

Freeze binaries/model content IDs, hardware, tool permissions, prompts, original total budgets,
arm order with blocked randomization, usage accounting and infrastructure-failure rules. Neutral
smokes run for every product/model. Count unknown provider usage separately and retain failed starts.
Never wait for Swarm success before competitor launches. No favorable-result retries.

Primary metric: complete correct deliveries per total resource budget. Report paired wins/losses/
ties, per-family and per-model outcomes, task-cluster bootstrap intervals, all repeats, correctness
versus product recognition, repair gain/damage, verification overhead and human intervention.
Practical retention threshold to preregister: at least two more complete deliveries per 20 unique
tasks without increased total budget, no newly introduced preservation failures, and improvement
in at least two families. This threshold is a product decision, not statistical proof. Broad claims
also need uncertainty compatible with benefit, repeated evidence and competent comparator setups.

## Metadata inventory, not launch-ready tasks

The [candidate inventory](candidates.json) contains 20 identities in six repositories and two
languages. The [scan](exposure.json) found no remaining commit-prefix matches after excluding
three exposed identities. It searched 18,284 tracked files and expanded 161 archives. This
check does not establish semantic novelty or absence from model training.

Metadata alone also reveals feasibility concerns: attrs' proposed feature is typing examples,
pluggy's proposed compatibility change is a pyupgrade sweep, and Fastify's proposed refactor
removes a public type. They cannot be assumed to satisfy the intended task families. Retain
them as rejected-or-pending inventory until the task review chooses replacements by an amended
rule. No held-out workers ran and no hidden evaluator has been validated for these candidates.
The 20-task coverage target therefore remains unmet at the executable benchmark level.
