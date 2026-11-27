#!/bin/bash
# The seeded-fault task again, on the candidate that samples two replies after a repeat.
W=/Users/brad/projects/recovery-2026-10-31/run-closeout
for n in 4 5 6; do $W/dev2.sh $W/install-rc21 cand-invoice-seeded-$n invoice seeded; done
