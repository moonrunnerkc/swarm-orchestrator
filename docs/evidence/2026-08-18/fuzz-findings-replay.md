# Findings replay, 2026-08-18

Harness build: npm run fuzz:build, fresh. Tree at v13-main 7ffea2cf.
Each input replayed byte-exact through fuzz/scrub.fuzz.cjs, the same entry point
fuzz/smoke.mjs uses.

```

=== scrub-dispatch-flip.input (63 bytes) ===
  raw: "{\"_nto__\":{\"]pk_key\":\"46[es\"},\"api_key\":\"�?�\u0000o\bktotype/p\"}\n"
  RESULT: passes, no throw

=== scrub-marker-in-key.input (53 bytes) ===
  raw: "{\"fghN: : , PIN:����34\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000ughputA\":9912}\n"
  RESULT: passes, no throw

=== scrub-name-separator.input (45 bytes) ===
  raw: "{\"api/_key\":\"sk-abcdef45\",\"throughput\":9911}\n"
  RESULT: passes, no throw

=== scrub-nested-multibyte-key.input (66 bytes) ===
  raw: "{\"neste�����d\":{\"deep\":{\"client_secret\":\"0123456789abcdefghij\"}}}\n"
  RESULT: passes, no throw

=== scrub-overlapping-spans.input (208 bytes) ===
  raw: "api_key = \"AKIAIOSFODNN7EXAMPLEconstructor:\"sk-abcdefgjklmnpy = \"AKIAIOSFconstructorODNN7Ekey = \"AKIAIOSFODNN7Eapi_key = \"AKIAIOSFconsXAMPLE\"\napai_XAMPLE\"\napatructorODNN7Ekeyi_ke =y\":\"sk-abcde oqLE\"\n\"AKIAIOSF"
  RESULT: passes, no throw
```

## A/B across the closing commit, scrub-nested-multibyte-key

The finding was a scrub/export disagreement, so the check is whether the two sites
agree on those bytes. Built da7b9794~1 in a detached worktree and ran both.

```
=== at da7b9794~1 (parent) ===
  scrubText redactions : []
  export scan residual : ["credential-assignment"]
  VERDICT              : sites DISAGREE
=== at v13-main HEAD ===
  scrubText redactions : ["credential-field"]
  export scan residual : []
  VERDICT              : sites AGREE
```
