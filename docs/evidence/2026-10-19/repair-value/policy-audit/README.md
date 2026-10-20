# The policy audit's records

- [hold-rule-before.txt](hold-rule-before.txt), [hold-rule-after.txt](hold-rule-after.txt): the
  three hold-rule tests (two new, one existing with the stop's class asserted) on `f556b6313`'s
  product source, where all three fail, and after `10ee69729`, with the O1-shape rollback test
  beside them. Scripted model.
- [probe-before.txt](probe-before.txt): the argument probe's false rejection, reproduced on
  `f556b6313`'s product source by the first form of the test (which expected admission);
  [probe-after.txt](probe-after.txt): the test in its final form, which holds the refusal, its
  stated reason and the revision's admission. Scripted model.
- [relation-limit.mjs](relation-limit.mjs) and [relation-limit-f556b6313/](relation-limit-f556b6313/analysis.json):
  the relation false in its own fixture, on the real mime project, through `f556b6313`'s build.
  The correct repair is rolled back and launch 4's space normalization is delivered; the frozen
  evaluator passes it and the custom-extension check fails it ([scores](relation-limit-f556b6313/scores/scores.json)).
  Through the frozen build of this work, [relation-limit-e2b0fe77c/](relation-limit-e2b0fe77c/analysis.json):
  the claim relation yields to the restored kept case, the correct repair is kept and delivered
  (`54e61a8`; both external readings pass), and the run reports `unresolved` because the false
  relation keeps failing. The bundle's own verifier re-derives the yield in agreement.
