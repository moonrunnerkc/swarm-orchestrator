# Client session of swarm-verify@1.0.0, 2026-09-28T00:33:35Z
### mcp --describe
swarm_verify_check: Run swarm-verify check over a workspace under the server root: discover the declared checks, run them unattended, and return the swarm.check.v1 report. A pass is regression-only; task correctness is unmeasured without a contract.
swarm_verify_status: The last swarm_verify_check report this server produced for a workspace, or none.
swarm_verify_evidence: Read one file of an evidence bundle: manifest.json, summary.md, report.json or verdict.json, from a bundle under the session store or the server root. Bounded to 64 KB.
[exit 0]

### mcp session over stdio
--- initialize
{
 "jsonrpc": "2.0",
 "id": 1,
 "result": {
  "protocolVersion": "2025-06-18",
  "capabilities": {
   "tools": {
    "listChanged": false
   }
  },
  "serverInfo": {
   "name": "swarm-verify",
   "version": "1.0.0"
  },
  "instructions": "Three bounded tools over the verifier: swarm_verify_check runs the declared checks of a workspace under the server root and returns the report; swarm_verify_status returns the last report; swarm_verify_evidence reads one bundle file. A regression pass says nothing broke, not that the task was done."
 }
}
--- tools/list
[
 "swarm_verify_check",
 "swarm_verify_status",
 "swarm_verify_evidence"
]
--- tools/call swarm_verify_check
{
 "result": "pass"
}
--- tools/call swarm_verify_status
"{\"schema\":\"swarm.check.v1\",\"plan\":{\"version\":\"swarm.check-plan.v1\",\"workspace\":\"/Users/brad/.cache/swarm-client-fwTJVc\",\"project\":{\"types\":[\"node\"],\"manifests\":[\"package.json\"],\"nodeManager\":\"npm\",\"lockfiles\":[],\"pythonCommand\":null,\"setupProblem\":null},\"packages\":[],\"scope\":{\"kind\":\"root\",\"selected\":[\".\"],\"detail\":\"the root manifest declares the checks for the whole repository\"},\"tests\":{\"script\":\"test\",\"body\":\"node --test\",\"runner\":\"node-test\",\"noninteractiveBy\":[\"no terminal on stdin\",\"node --test runs once unless --watch is named\"],\"interactive\":null},\"declaredChecks\":[{\"id\":\"tests\",\"command\":\"npm run --silent test\",\"unavailable\":null},{\"id\":\"typecheck\",\"command\":null,\"unavailable\":\"package.json declares no typecheck script\"},{\"id\":\"lint\",\"command\":null,\"unavailable\":\"package.json decl"
--- tools/call swarm_verify_evidence (manifest.json)
"{\n  \"bundleFormat\": 2,\n  \"ledgerSchemaVersion\": 1,\n  \"sessionId\": \"20260928T003336-f4036d\",\n  \"exportedAt\": 1790555617483,\n  \"recordCount\": 19,\n  \"chainHead\": \"sha256:319ac9617834f35edcd78f31da1a6215d14b20f3acbdb01594ea2cf1b8604436\",\n  \"signature\": {\n    \"algorithm\": \"ed25519\",\n    \"publicKey\": \"MCowBQYDK2VwAyEAxDAEpPMylLhTVyuQ6kEjo9hUaqa8pLcL1S7Kcmpejng=\",\n    \"value\": \"FD/EBjsQFCyF1t1+m/rLtfH6EhkZbgu5NBvQuTvMdpPdDNT/LH8fSjuzxYd9DOxg4l+92Kr634XC+SslfciCDA==\",\n    \"keySource\": \"keychain\"\n  },\n  \"blobs\": [\n    \"sha256:21293e86edbb853b3fe59b5192893efa6e79ea35928f58b47aab25ce1ee3d4a5\",\n    \"sha25"
[exit 0]

### hook install
installed: /usr/local/bin/node /Users/brad/.npm/_npx/c7317cfa99b1c8a0/node_modules/.bin/swarm-verify hook run in /Users/brad/.cache/swarm-client-fwTJVc/.claude/settings.json
events: PreToolUse and PostToolUse on the Bash tool. Remove with `swarm-verify hook uninstall`.
[exit 0]

### hook settings
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/usr/local/bin/node /Users/brad/.npm/_npx/c7317cfa99b1c8a0/node_modules/.bin/swarm-verify hook run",
            "timeout": 900
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/usr/local/bin/node /Users/brad/.npm/_npx/c7317cfa99b1c8a0/node_modules/.bin/swarm-verify hook run",
            "timeout": 900
          }
        ]
      }
    ]
  }
}
[exit 0]

### hook run PreToolUse (npm test)
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"routed through swarm-verify so the run is recorded: npm test became /usr/local/bin/node /Users/brad/.npm/_npx/c7317cfa99b1c8a0/node_modules/.bin/swarm-verify check --workspace /Users/brad/.cache/swarm-client-fwTJVc","updatedInput":{"command":"/usr/local/bin/node /Users/brad/.npm/_npx/c7317cfa99b1c8a0/node_modules/.bin/swarm-verify check --workspace /Users/brad/.cache/swarm-client-fwTJVc"}}}
[exit 0]

### hook run PreToolUse (pipeline, left alone)
[exit 0]

### hook uninstall
removed in /Users/brad/.cache/swarm-client-fwTJVc/.claude/settings.json
[exit 0]

### pre-commit install
installed: /Users/brad/.cache/swarm-client-fwTJVc/.git/hooks/pre-commit
verifies the staged tree before each commit; `git commit --no-verify` skips it, and CI stays the boundary.
[exit 0]

### commit a passing change
staged tree 426673107b9aa6d45ec32964333f358771930878 (commit a8c01718116b on c672fa014108)
dependencies none borrowed
workspace    /var/folders/1q/2_tt_q515bs98g0f5v17_sdc0000gn/T/swarm-precommit-l1xNph/staged (a8c01718116b, clean)
project      node, npm
scope        root: the root manifest declares the checks for the whole repository
command      npm run --silent test [node --test] (node-test; no terminal on stdin, node --test runs once unless --watch is named)
             ran: exited 0 in 0.1s: 1 collected, 1 passed, 0 failed, 0 skipped (exit 0)
checks       passed 4 (tests, placeholder, secret-scan, diff-budget), failed 0, not run 5 (typecheck, lint, format, file-set, behaviour-probe)
             typecheck: package.json declares no typecheck script
             lint: package.json declares no lint script
             format: package.json declares no check-only format script, and running a writing formatter as a gate would edit the tree it is judging
             file-set: no file set was declared for this run and nothing changed, so there was no membership to check
             behaviour-probe: no changed function could be probed, so nothing about behaviour was measured.
execution    restricted: commands ran on this host with a built environment and no credentials; that is a policy, not a sandbox, and the project's tests ran the project's code
requirements unmeasured: no requirement contract was supplied, so task correctness was not judged. A passing suite says nothing broke, not that the work was done
challenges   none: no check was challenged: challenges need a requirement contract to name what a check must detect
unmeasured   build: package.json declares no build script
result       regression-only pass: the declared checks passed on this tree; task correctness is unmeasured (exit 0)
evidence     /Users/brad/.swarm/sessions/20260928T003340-30aaad/bundle
             verify it anywhere: node /Users/brad/.swarm/sessions/20260928T003340-30aaad/bundle/verify.mjs /Users/brad/.swarm/sessions/20260928T003340-30aaad/bundle
[exit 0]

### commit a breaking change (expected refused)
staged tree 934f1ceed60fb38f98a86244a2d3e8e1539052b8 (commit 2048471fbccb on 5e7011e1dd1e)
dependencies none borrowed
workspace    /var/folders/1q/2_tt_q515bs98g0f5v17_sdc0000gn/T/swarm-precommit-3Qu3eL/staged (2048471fbccb, clean)
project      node, npm
scope        root: the root manifest declares the checks for the whole repository
command      npm run --silent test [node --test] (node-test; no terminal on stdin, node --test runs once unless --watch is named)
             ran: exited 1 in 0.1s: 1 collected, 0 passed, 1 failed, 0 skipped (exit 1)
checks       passed 3 (placeholder, secret-scan, diff-budget), failed 1 (tests), not run 5 (typecheck, lint, format, file-set, behaviour-probe)
             tests: 1 collected, 0 passed, 1 failed, 0 skipped (exit 1)
               | FN:1,add
               | FNDA:1,add
               | FNF:1
               | FNH:1
               | BRDA:1,0,0,1
               | BRDA:1,1,0,1
               | BRF:2
               | BRH:2
               | DA:1,1
               | LH:1
               | LF:1
               | end_of_record
             typecheck: package.json declares no typecheck script
             lint: package.json declares no lint script
             format: package.json declares no check-only format script, and running a writing formatter as a gate would edit the tree it is judging
             file-set: no file set was declared for this run and nothing changed, so there was no membership to check
             behaviour-probe: no changed function could be probed, so nothing about behaviour was measured.
execution    restricted: commands ran on this host with a built environment and no credentials; that is a policy, not a sandbox, and the project's tests ran the project's code
requirements unmeasured: no requirement contract was supplied, so task correctness was not judged. A passing suite says nothing broke, not that the work was done
challenges   none: no check was challenged: challenges need a requirement contract to name what a check must detect
unmeasured   build: package.json declares no build script
result       fail: a blocking check failed (exit 1)
evidence     /Users/brad/.swarm/sessions/20260928T003341-3b9092/bundle
             verify it anywhere: node /Users/brad/.swarm/sessions/20260928T003341-3b9092/bundle/verify.mjs /Users/brad/.swarm/sessions/20260928T003341-3b9092/bundle
[exit 1]

### git log after
5e7011e twice
c672fa0 base
[exit 0]

