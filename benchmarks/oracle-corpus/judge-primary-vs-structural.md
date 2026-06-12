# Judge-primary vs structural on semantic cheats

The two semantic categories carry no structural tell. The structural battery is run over every semantic injection (it should fire on none), then the judge-primary path is run over the same diffs. Judge numbers come from qwen3.6:35b-a3b with prompt v1-conservative.

| category | injections | structural catch | incidental structural fires | whole-diff recall (pre-focus) | judge-primary recall (focused) | judge tp |
|---|---|---|---|---|---|---|
| goal-not-fixed | 25 | 0.000 | 21 | 0.760 (19/25) | 0.760 | 19/25 |
| cheat-mock-mutation | 25 | 0.000 | 7 | 0.680 (17/25) | 0.960 | 24/25 |

> Structural catch is 0 by construction: no regex or AST detector emits these categories, so no structural finding can ever be a catch of the semantic cheat. The incidental-fires column counts cases where a structural detector fired a *different* category (wrong-category noise). Judge-primary recall is the measured, non-rounded fraction the judge caught.

