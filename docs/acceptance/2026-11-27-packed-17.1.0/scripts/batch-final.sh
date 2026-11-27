#!/bin/bash
# The packed 17.1.0 with swarm-verify 3.2.0 from the registry: one fresh session of each task.
W=/Users/brad/projects/recovery-2026-10-31/run-closeout
I=$W/install-final
$W/final.sh $I packed-invoice-feature-1 invoice feature
$W/final.sh $I packed-notes-feature-1 notes feature
$W/final.sh $I packed-invoice-seeded-1 invoice seeded
