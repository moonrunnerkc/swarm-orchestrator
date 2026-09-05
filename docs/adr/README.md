# Architecture decision records

One file per decision that would otherwise have to be re-derived from the code. Each says what
was decided, what it replaced, and what it does not buy, because a decision recorded without its
limits reads later as a guarantee.

| # | Decision | Status |
| - | -------- | ------ |
| [0001](0001-execution-modes.md) | Execution modes are measured, not asserted | accepted |
| [0002](0002-child-environment.md) | A child process gets a built environment, never an inherited one | accepted |
| [0003](0003-multidimensional-verdict.md) | A run's result is more than one answer | accepted |
| [0004](0004-signer-trust.md) | Bundle consistency and bundle authenticity are separate claims | accepted |
| [0005](0005-gate-capabilities.md) | A gate declares what a pass establishes | accepted |
| [0006](0006-one-cancellation-tree.md) | One place a run is stopped from | accepted |
