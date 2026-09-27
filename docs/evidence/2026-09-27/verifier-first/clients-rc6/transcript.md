# Client session of swarm-verify@1.0.0-rc.6, 2026-09-27T22:40:26Z
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
   "version": "1.0.0-rc.6"
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
"{\"schema\":\"swarm.check.v1\",\"plan\":{\"version\":\"swarm.check-plan.v1\",\"workspace\":\"/Users/brad/.cache/swarm-client-pxMSbJ\",\"project\":{\"types\":[\"node\"],\"manifests\":[\"package.json\"],\"nodeManager\":\"npm\",\"lockfiles\":[],\"pythonCommand\":null,\"setupProblem\":null},\"packages\":[],\"scope\":{\"kind\":\"root\",\"selected\":[\".\"],\"detail\":\"the root manifest declares the checks for the whole repository\"},\"tests\":{\"script\":\"test\",\"body\":\"node --test\",\"runner\":\"node-test\",\"noninteractiveBy\":[\"no terminal on stdin\",\"node --test runs once unless --watch is named\"],\"interactive\":null},\"declaredChecks\":[{\"id\":\"tests\",\"command\":\"npm run --silent test\",\"unavailable\":null},{\"id\":\"typecheck\",\"command\":null,\"unavailable\":\"package.json declares no typecheck script\"},{\"id\":\"lint\",\"command\":null,\"unavailable\":\"package.json decl"
--- tools/call swarm_verify_evidence (manifest.json)
"manifest.json is not in /Users/brad/.swarm/sessions"
[exit 0]

### hook install
installed: /usr/local/bin/node /Users/brad/.npm/_npx/f8b1d4b2ae214f9d/node_modules/.bin/swarm-verify hook run in /Users/brad/.cache/swarm-client-pxMSbJ/.claude/settings.json
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
            "command": "/usr/local/bin/node /Users/brad/.npm/_npx/f8b1d4b2ae214f9d/node_modules/.bin/swarm-verify hook run",
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
            "command": "/usr/local/bin/node /Users/brad/.npm/_npx/f8b1d4b2ae214f9d/node_modules/.bin/swarm-verify hook run",
            "timeout": 900
          }
        ]
      }
    ]
  }
}
[exit 0]

### hook run PreToolUse (npm test)
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"routed through swarm-verify so the run is recorded: npm test became /usr/local/bin/node /Users/brad/.npm/_npx/f8b1d4b2ae214f9d/node_modules/.bin/swarm-verify check --workspace /Users/brad/.cache/swarm-client-pxMSbJ","updatedInput":{"command":"/usr/local/bin/node /Users/brad/.npm/_npx/f8b1d4b2ae214f9d/node_modules/.bin/swarm-verify check --workspace /Users/brad/.cache/swarm-client-pxMSbJ"}}}
[exit 0]

### hook run PreToolUse (pipeline, left alone)
[exit 0]

### hook uninstall
removed in /Users/brad/.cache/swarm-client-pxMSbJ/.claude/settings.json
[exit 0]

### pre-commit install
installed: /Users/brad/.cache/swarm-client-pxMSbJ/.git/hooks/pre-commit
verifies the staged tree before each commit; `git commit --no-verify` skips it, and CI stays the boundary.
[exit 0]

### commit a passing change
staged tree aa5a2e3963e3ee3817370b2b6289cbd4014f1b42 (commit b38918b9fdf7 on 0c02b592775d)
dependencies none borrowed
workspace    /var/folders/1q/2_tt_q515bs98g0f5v17_sdc0000gn/T/swarm-precommit-aZsAJ6/staged (b38918b9fdf7, clean)
project      node, npm
scope        root: the root manifest declares the checks for the whole repository
command      npm run --silent test [node --test] (node-test; no terminal on stdin, node --test runs once unless --watch is named)
             ran: exited 0 in 0.1s: 1 collected, 1 passed, 0 failed, 0 skipped (exit 0)
checks       passed 4 (tests, placeholder, secret-scan, diff-budget), failed 0, not run 5 (typecheck, lint, format, file-set, behaviour-probe)
             typecheck: package.json declares no typecheck script
             lint: package.json declares no lint script
             format: package.json declares no check-only format script, and running a writing formatter as a gate would edit the tree it is judging
             file-set: nothing changed, and no scope was authorised because no agent ran
             behaviour-probe: no changed function could be probed, so nothing about behaviour was measured.
execution    restricted: commands ran on this host with a built environment and no credentials; that is a policy, not a sandbox, and the project's tests ran the project's code
requirements unmeasured: no requirement contract was supplied, so task correctness was not judged. A passing suite says nothing broke, not that the work was done
challenges   none: no check was challenged: challenges need a requirement contract to name what a check must detect
unmeasured   build: package.json declares no build script
result       regression-only pass: the declared checks passed on this tree; task correctness is unmeasured (exit 0)
evidence     /Users/brad/.swarm/sessions/20260927T224032-2a32a0/bundle
             verify it anywhere: node /Users/brad/.swarm/sessions/20260927T224032-2a32a0/bundle/verify.mjs /Users/brad/.swarm/sessions/20260927T224032-2a32a0/bundle
[exit 0]

### commit a breaking change (expected refused)
staged tree 2b339e39518262689cde2512b4958b3254716fc2 (commit 1350c751f96c on e8c57c21e083)
dependencies none borrowed
workspace    /var/folders/1q/2_tt_q515bs98g0f5v17_sdc0000gn/T/swarm-precommit-mQKx0m/staged (1350c751f96c, clean)
project      node, npm
scope        root: the root manifest declares the checks for the whole repository
command      npm run --silent test [node --test] (node-test; no terminal on stdin, node --test runs once unless --watch is named)
             ran: exited 1 in 0.1s: 1 collected, 0 passed, 1 failed, 0 skipped (exit 1)
checks       passed 3 (placeholder, secret-scan, diff-budget), failed 1 (tests), not run 5 (typecheck, lint, format, file-set, behaviour-probe)
             tests: 1 collected, 0 passed, 1 failed, 0 skipped (exit 1)
             typecheck: package.json declares no typecheck script
             lint: package.json declares no lint script
             format: package.json declares no check-only format script, and running a writing formatter as a gate would edit the tree it is judging
             file-set: nothing changed, and no scope was authorised because no agent ran
             behaviour-probe: no changed function could be probed, so nothing about behaviour was measured.
execution    restricted: commands ran on this host with a built environment and no credentials; that is a policy, not a sandbox, and the project's tests ran the project's code
requirements unmeasured: no requirement contract was supplied, so task correctness was not judged. A passing suite says nothing broke, not that the work was done
challenges   none: no check was challenged: challenges need a requirement contract to name what a check must detect
unmeasured   build: package.json declares no build script
result       fail: a blocking check failed (exit 1)
evidence     /Users/brad/.swarm/sessions/20260927T224033-46aeed/bundle
             verify it anywhere: node /Users/brad/.swarm/sessions/20260927T224033-46aeed/bundle/verify.mjs /Users/brad/.swarm/sessions/20260927T224033-46aeed/bundle
[exit 1]

### git log after
e8c57c2 twice
0c02b59 base
[exit 0]

