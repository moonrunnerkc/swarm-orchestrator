#!/bin/bash
# Fresh sessions of each task on the candidate pair, one after another; every attempt is kept.
W=/Users/brad/projects/recovery-2026-10-31/run-closeout
I=$W/install-rc20
for n in 1 2 3; do
  $W/dev2.sh $I cand-invoice-feature-$n invoice feature
  $W/dev2.sh $I cand-notes-feature-$n notes feature
  $W/dev2.sh $I cand-invoice-seeded-$n invoice seeded
done
$W/dev2.sh $I cand-invoice-repair-1 invoice repair
